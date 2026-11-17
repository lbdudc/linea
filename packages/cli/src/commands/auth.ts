import fs from 'node:fs';
import { createGitProvider } from '@lbdudc/linea-git';
import { flagString, parseFlags } from '../core/args.js';
import { config } from '../core/config.js';
import { configureClient, splalm, startAutoRefresh } from '../core/client.js';
import { clearAuth, loadState, saveState, type StoredGit } from '../core/credentials.js';
import { gitConfigOf, hostLabel } from '../core/git.js';
import { checkGitAccess, cloneUrlOf, credentialOptions, gitAsync } from '../core/gitops.js';
import { runLoopbackOAuth } from '../oauth/loopback.js';
import type { LoginResponse, PublicConfig } from '../core/types.js';
import type { Command, CommandContext } from './types.js';

type HostId = NonNullable<PublicConfig['provider']>;

/** The host a sign-in is for: the one asked with `--host`, else the primary one; it has to be one the server has on. */
export function hostToSignIn(cfg: PublicConfig, asked: string | undefined): HostId {
  const on = (cfg.hosts?.map((host) => host.id) ?? [cfg.provider ?? 'gitlab']) as HostId[];
  const wanted = (asked ?? cfg.primary ?? cfg.provider ?? on[0] ?? 'gitlab') as HostId;
  if (!on.includes(wanted)) throw new Error(`This LINEA does not have ${asked} on (it has: ${on.join(', ')}).`);
  return wanted;
}

/** The part of the server's `/users/config` that is of one host (older servers only have the primary one, at the top). */
const configOf = (cfg: PublicConfig, host: HostId): PublicConfig =>
  ({ ...cfg, ...(cfg.hosts?.find((entry) => entry.id === host) ?? {}), provider: host }) as PublicConfig;

/** The browser round trip: LINEA's server gets the code, and gives the CLI a session. */
async function signIn(ctx: CommandContext, all: PublicConfig, host: HostId): Promise<LoginResponse> {
  const cfg = configOf(all, host);
  if (!cfg.clientId || !cfg.url) {
    throw new Error(`The backend's /api/users/config didn't return a ${hostLabel(host)} clientId/url (internal_error).`);
  }
  const name = hostLabel(host);
  ctx.setStatus(`waiting for ${name} authorization (${cfg.url}) in your browser…`);
  const { code, redirectUri } = await runLoopbackOAuth({
    authorizeBase: cfg.url,
    ...(cfg.authorizeUrl ? { authorizeUrl: cfg.authorizeUrl } : {}),
    ...(cfg.scope ? { scope: cfg.scope } : {}),
    clientId: cfg.clientId,
    port: config.LOOPBACK_PORT,
    onUrl: (url) => ctx.print(`Opening your browser to authorize with ${name}.\n  If it didn't open, visit:\n  ${url}`, 'info'),
  });

  ctx.setStatus('exchanging authorization code…');
  // (the old path is the primary host's, and the one servers from before there were several hosts have; the others go by name)
  const primary = all.primary ?? all.provider ?? 'gitlab';
  const res = (await splalm.post(host === primary ? '/api/users/loginFromGitLabNative' : `/api/users/login/${host}/native`, { code, redirect_uri: redirectUri })) as LoginResponse;
  return keepSession(ctx, res);
}

function keepSession(ctx: CommandContext, res: LoginResponse): LoginResponse {
  configureClient({ token: res.token });
  startAutoRefresh();
  saveState({ token: res.token, user: res.user });
  ctx.updateSession({ authed: true, user: res.user });
  return res;
}

/** A LINEA that keeps its repositories itself has its own accounts: a name and a password (never printed, never kept: the session is). */
async function signInLocal(ctx: CommandContext, username: string | undefined, password: string | undefined): Promise<LoginResponse> {
  if (!username || !password) {
    throw new Error('This LINEA has its own accounts: login --host local --username <name> --password <password or file> (or LINEA_PASSWORD in the environment).');
  }
  ctx.setStatus(`signing in as ${username}…`);
  const res = (await splalm.post('/api/users/login/local', { username, password })) as LoginResponse;
  return keepSession(ctx, res);
}

/** A token given as the token itself, or as the path of a file that holds it. It is never printed. */
function readToken(value: string): string {
  const token = (fs.existsSync(value) && fs.statSync(value).isFile() ? fs.readFileSync(value, 'utf8') : value).trim();
  if (!token || /\s/.test(token)) throw new Error('That is not a token: give the token itself, or the path of a file that only holds it.');
  return token;
}

/**
 * Uses a personal access token as the git access, in place of the one the server would give: for a server that does not give one
 * (it is older than this CLI), or for someone who prefers their own. The host is the one the LINEA server says it is on, and the host
 * is asked whether it accepts the token before it is kept.
 */
async function usePersonalToken(ctx: CommandContext, cfg: PublicConfig, token: string, username: string | undefined): Promise<string> {
  const provider = cfg.provider === 'github' ? 'github' : 'gitlab';
  const stored: StoredGit = {
    server: ctx.session.baseUrl,
    source: 'token',
    provider,
    host: provider === 'github' ? { webUrl: cfg.url } : { url: cfg.url },
    // the name goes with the token to git: GitLab takes any but an empty one ("oauth2" is what it documents), GitHub "x-access-token"
    username: username ?? (provider === 'github' ? 'x-access-token' : 'oauth2'),
    token,
  };
  const name = provider === 'github' ? 'GitHub' : 'GitLab';
  try {
    await createGitProvider(gitConfigOf(stored)).getUser({ token });
  } catch (e) {
    throw new Error(`${name} (${cfg.url}) did not accept that token: ${(e as Error).message}. It needs the scope ${provider === 'github' ? '`repo`' : '`api`'}.`);
  }

  // the host's API accepting a token is not git accepting it: a repository of yours is read the way `get` will read it
  const git = createGitProvider(gitConfigOf(stored));
  const repos = await git.listRepositories({ token, topic: 'spl' }).catch(() => []);
  if (repos[0]) {
    ctx.setStatus(`trying git on ${repos[0].path}…`);
    const tried = await checkGitAccess(cloneUrlOf(repos[0].webUrl), stored.username, token);
    if (!tried.ok) {
      throw new Error(
        `${name} accepts the token for its API but not for git (${repos[0].path}): ${tried.said.split('\n').slice(-1)[0]}\n` +
          `  A ${provider === 'github' ? 'GitHub token needs the scope `repo`' : 'GitLab token needs the scopes `read_repository` and `write_repository` (or `api`)'}. Make a new one, and: login --token <token or file>`,
      );
    }
  }
  // kept, and then tried the way `get` and `push` will use it: through linea's credential helper, which is not the same as git being
  // sent the token directly (a helper that git does not run, or does not trust, is a failure that only shows there)
  // (the server goes with it: the helper is another process, and only gives git access that belongs to the server it finds saved)
  const previous = loadState();
  saveState({ git: stored, baseUrl: ctx.session.baseUrl });
  if (repos[0]) {
    const url = cloneUrlOf(repos[0].webUrl);
    ctx.setStatus(`trying git on ${repos[0].path} the way get does…`);
    const viaHelper = await gitAsync(undefined, [...credentialOptions(url), 'ls-remote', '--heads', url]);
    if (viaHelper.status !== 0) {
      saveState({ git: previous.git, baseUrl: previous.baseUrl });
      throw new Error(
        `${name} accepts the token when git is sent it directly, but not through linea's credential helper, which is what get and push use ` +
          `(${repos[0].path}): ${(viaHelper.stderr || viaHelper.stdout).trim().split('\n').slice(-1)[0]}\n` +
          `  Set LINEA_DEBUG=1 and run login --token again: ~/.linea/credential.log says whether git asked linea for the token at all.`,
      );
    }
  }
  return `${name} (${cfg.url}) accepted the token${repos[0] ? ' for its API and for git, through the credential helper too' : ' for its API (it has no SPL repository to try git on yet)'}: get, push and the registry use it from now on.`;
}

const login: Command = {
  name: 'login',
  summary: 'Sign in to LINEA: with your git host (opens your browser), or with your account here when LINEA keeps the repositories itself; --token gives a personal access token for git instead',
  usage: 'login [--host gitlab|github|local] [--token <token or file>] [--username name] [--password <password or file>]',
  flags: ['--host name', '--token <token or file>', '--username name', '--password <password or file>'],
  run: async (ctx) => {
    const { flags } = parseFlags(ctx.args, { value: { token: undefined, username: undefined, host: undefined, password: undefined } });
    const given = flagString(flags, 'token');
    const personal = given === undefined ? undefined : readToken(given);
    const cfg = (await splalm.get('/api/users/config')) as PublicConfig;
    const host = hostToSignIn(cfg, flagString(flags, 'host'));

    // already signed in, and only the token is wanted: no browser
    let username = ctx.session.user?.username;
    if (host === 'local') {
      if (personal !== undefined) throw new Error('A personal token is for GitLab or GitHub; here you sign in with your account (the git token comes with it).');
      const password = flagString(flags, 'password') ?? process.env['LINEA_PASSWORD'];
      username = (await signInLocal(ctx, flagString(flags, 'username'), password === undefined ? undefined : readSecret(password))).user.username;
    } else if (personal === undefined || !ctx.session.authed) {
      username = (await signIn(ctx, cfg, host)).user.username;
    }

    if (personal !== undefined) {
      ctx.print(await usePersonalToken(ctx, configOf(cfg, host), personal, flagString(flags, 'username')), 'info');
      return `✓ Signed in${username ? ` as ${username}` : ''}.`;
    }

    const git = await storeGitCredentials(ctx.session.baseUrl);
    ctx.print(
      git
        ? `Git access to ${git} is set up too: get and push work.`
        : 'This LINEA server did not give git access (it may be older than this CLI). Give a personal access token for your git host: login --token <token or file>',
      'info',
    );
    return `✓ Signed in as ${username}.`;
  },
};

/** A password given as itself or as the path of a file that holds it. */
function readSecret(value: string): string {
  return (fs.existsSync(value) && fs.statSync(value).isFile() ? fs.readFileSync(value, 'utf8') : value).replace(/\r?\n$/, '');
}

/** Which remote the lines and products are of (the profile), when the person has accounts on more than one host. */
const profile: Command = {
  name: 'profile',
  summary: 'The git host you are working on (your profile) when you have accounts on more than one: profile, or profile <host> to switch',
  usage: 'profile [gitlab|github|local]',
  run: async (ctx) => {
    if (!ctx.session.authed) return 'Not signed in. Run: login';
    const wanted = ctx.args.find((arg) => !arg.startsWith('-'));
    const answer = (wanted
      ? await splalm.put('/api/users/profile', { host: wanted })
      : await splalm.post('/api/users/loginFromServiceToken').then((res) => (res as { user: { hosts?: string[]; activeHost?: string | null } }).user)) as { hosts?: string[]; activeHost?: string | null };
    if (wanted) {
      // what git is given follows the profile
      await storeGitCredentials(ctx.session.baseUrl, { force: true });
      return `✓ Working on ${hostLabel(answer.activeHost ?? wanted)} now.`;
    }
    return [`Working on: ${answer.activeHost ? hostLabel(answer.activeHost) : 'none (none of your hosts is on)'}`, `Accounts:   ${(answer.hosts ?? []).map(hostLabel).join(', ') || '—'}`].join('\n');
  },
};

/**
 * The user's own git token and host, from the server, kept for `git` and the registry; the name of the host, or undefined. What is kept
 * belongs to the server it came from. A token the user gave is theirs: it stays, and what the server says does not replace it.
 */
export async function storeGitCredentials(server: string, { force = false }: { force?: boolean } = {}): Promise<string | undefined> {
  const kept = loadState().git;
  if (!force && kept?.source === 'token' && kept.server === server) return hostLabel(kept.provider);
  try {
    const creds = (await splalm.get('/api/users/git-credentials')) as Omit<StoredGit, 'server' | 'source'>;
    if (!creds?.token) throw new Error('no token');
    saveState({ git: { ...creds, server, source: 'server' } });
    return hostLabel(creds.provider);
  } catch {
    // whatever was kept came from somewhere else (or from before this server was asked): it is not this server's
    saveState({ git: undefined });
    return undefined;
  }
}

const logout: Command = {
  name: 'logout',
  summary: 'Sign out and clear stored credentials',
  usage: 'logout',
  run: async (ctx) => {
    try {
      await splalm.post('/api/users/logout');
    } catch {
      // best-effort — we clear local state regardless
    }
    configureClient({ token: '' });
    clearAuth();
    ctx.updateSession({ authed: false, user: undefined });
    return 'Signed out.';
  },
};

const whoami: Command = {
  name: 'whoami',
  aliases: ['me'],
  summary: 'Show the signed-in user and current context',
  usage: 'whoami',
  run: async (ctx) => {
    if (!ctx.session.authed) return 'Not signed in. Run: login';
    const res = (await splalm.post('/api/users/loginFromServiceToken')) as LoginResponse;
    configureClient({ token: res.token });
    saveState({ token: res.token, user: res.user });
    ctx.updateSession({ authed: true, user: res.user });
    const git = await storeGitCredentials(ctx.session.baseUrl); // the git token is renewed along with the session
    return [
      `${res.user.username}  (id ${res.user.userId})`,
      `  server:     ${ctx.session.baseUrl}`,
      `  git access: ${git ?? 'none (login --token <token or file>)'}`,
    ].join('\n');
  },
};

export const authCommands: Command[] = [login, logout, whoami, profile];
