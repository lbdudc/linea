import fs from 'node:fs';
import { createGitProvider } from '@lbdudc/linea-git';
import { flagString, parseFlags } from '../core/args.js';
import { config } from '../core/config.js';
import { configureClient, SessionExpiredError, splalm, SplalmError, startAutoRefresh } from '../core/client.js';
import open from 'open';
import { clearAuth, loadState, saveState, storedGit, type StoredGit } from '../core/credentials.js';
import { contextLine, modeOf, shortServer } from '../core/mode.js';
import { gitConfigOf, hostLabel } from '../core/git.js';
import { checkGitAccess, cloneUrlOf, credentialOptions, gitAsync } from '../core/gitops.js';
import { runLoopbackOAuth } from '../oauth/loopback.js';
import type { LoginResponse, PublicConfig } from '../core/types.js';
import { commandNamed } from './lookup.js';
import type { Command, CommandContext } from './types.js';

export type HostId = NonNullable<PublicConfig['provider']>;

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

/** The browser round trip with a host: the code it gives back, and the loopback address it was sent to. */
export async function browserCode(ctx: CommandContext, all: PublicConfig, host: HostId): Promise<{ code: string; redirectUri: string }> {
  const cfg = configOf(all, host);
  if (!cfg.clientId || !cfg.url) {
    throw new Error(`The backend's /api/users/config didn't return a ${hostLabel(host)} clientId/url (internal_error).`);
  }
  const name = hostLabel(host);
  ctx.setStatus(`waiting for ${name} authorization (${cfg.url}) in your browser…`);
  return runLoopbackOAuth({
    authorizeBase: cfg.url,
    ...(cfg.authorizeUrl ? { authorizeUrl: cfg.authorizeUrl } : {}),
    ...(cfg.scope ? { scope: cfg.scope } : {}),
    clientId: cfg.clientId,
    port: config.LOOPBACK_PORT,
    onUrl: (url) => ctx.print(`Opening your browser to authorize with ${name}.\n  If it didn't open, visit:\n  ${url}\n  (no browser here? run it again with --device)`, 'info'),
  });
}

/** The browser round trip: LINEA's server gets the code, and gives the CLI a session. */
async function signIn(ctx: CommandContext, all: PublicConfig, host: HostId): Promise<LoginResponse> {
  const { code, redirectUri } = await browserCode(ctx, all, host);
  ctx.setStatus('exchanging authorization code…');
  // (the old path is the primary host's, and the one servers from before there were several hosts have; the others go by name)
  const primary = all.primary ?? all.provider ?? 'gitlab';
  const res = (await splalm.post(host === primary ? '/api/users/loginFromGitLabNative' : `/api/users/login/${host}/native`, { code, redirect_uri: redirectUri })) as LoginResponse;
  return keepSession(ctx, res);
}

function keepSession(ctx: CommandContext, res: LoginResponse): LoginResponse {
  configureClient({ token: res.token });
  startAutoRefresh();
  // signing in is choosing the server: the mode says so (and `login` says it was changed)
  saveState({ token: res.token, user: res.user, mode: 'server', baseUrl: ctx.session.baseUrl });
  ctx.updateSession({ authed: true, expired: false, user: res.user, mode: 'server' });
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
  saveState({ git: stored, baseUrl: ctx.session.baseUrl, personal: { ...previous.personal, [provider]: stored } });
  if (repos[0]) {
    const url = cloneUrlOf(repos[0].webUrl);
    ctx.setStatus(`trying git on ${repos[0].path} the way get does…`);
    const viaHelper = await gitAsync(undefined, [...credentialOptions(url), 'ls-remote', '--heads', url]);
    if (viaHelper.status !== 0) {
      saveState({ git: previous.git, baseUrl: previous.baseUrl, personal: previous.personal });
      throw new Error(
        `${name} accepts the token when git is sent it directly, but not through linea's credential helper, which is what get and push use ` +
          `(${repos[0].path}): ${(viaHelper.stderr || viaHelper.stdout).trim().split('\n').slice(-1)[0]}\n` +
          `  Set LINEA_DEBUG=1 and run login --token again: ~/.linea/credential.log says whether git asked linea for the token at all.`,
      );
    }
  }
  return `${name} (${cfg.url}) accepted the token${repos[0] ? ' for its API and for git, through the credential helper too' : ' for its API (it has no SPL repository to try git on yet)'}: get, push and the registry use it from now on.`;
}

/** Waits between polls; a test replaces it. */
export const timing = { sleep: (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve) => { const t = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true }); }) };

interface DeviceStart { deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete?: string; expiresIn: number; interval: number }

/**
 * Signs in (or links an account) without a browser on this machine: the person is shown an address and a code, approves on another
 * screen, and this polls LINEA, which asks the host. Resolves with what the server answers once the host has the approval.
 */
export async function runDeviceFlow(ctx: CommandContext, host: HostId, purpose: 'login' | 'link'): Promise<Record<string, unknown>> {
  const name = hostLabel(host);
  const start = (await splalm.post(`/api/users/device/${host}`)) as DeviceStart;
  ctx.print(`To sign in with ${name}, open  ${start.verificationUri}  and enter the code:  ${start.userCode}`, 'info');
  const complete = start.verificationUriComplete;
  if (complete && process.stdout.isTTY && !process.env['SSH_CONNECTION']) void open(complete).catch(() => {});
  ctx.setStatus(`waiting for you to approve it with ${name} (code ${start.userCode})…`);
  const path = purpose === 'login' ? `/api/users/login/${host}/device` : `/api/users/identities/${host}/device`;
  let interval = Math.max(1, start.interval);
  const deadline = Date.now() + start.expiresIn * 1000;
  while (Date.now() < deadline) {
    await timing.sleep(interval * 1000, ctx.signal);
    if (ctx.signal?.aborted) throw new Error('Cancelled.');
    const answer = (await splalm.post(path, { device_code: start.deviceCode, interval })) as Record<string, unknown>;
    if (answer['status'] === 'pending') {
      interval = Math.max(interval, Number(answer['interval'] ?? interval));
      continue;
    }
    return answer;
  }
  throw new Error('The code expired before it was approved: run the command again.');
}

/** The remotes the server has on, with what each can sign in with, for a message. */
export function remotesText(cfg: PublicConfig): string {
  return (cfg.hosts ?? []).map((h) => h.id).join(', ') || (cfg.provider ?? 'none');
}

const login: Command = {
  name: 'login',
  summary: 'Sign in to the LINEA server through one of its remotes: the browser, a code (--device), a token (--token) or, for LINEA git, a password',
  usage: 'login [gitlab|github|local] [--device] [--token <token or file>] [--username name] [--password <password or file>]',
  flags: ['--device', '--token <token or file>', '--username name', '--password <password or file>', '--host name'],
  run: async (ctx) => {
    const { flags, positional } = parseFlags(ctx.args, { value: { token: undefined, username: undefined, host: undefined, password: undefined }, bool: { device: undefined } });
    const given = flagString(flags, 'token');
    const personal = given === undefined ? undefined : readToken(given);
    const cfg = (await splalm.get('/api/users/config')) as PublicConfig;
    const host = hostToSignIn(cfg, positional[0] ?? flagString(flags, 'host'));
    const wasMode = modeOf(ctx.session);
    const entry = cfg.hosts?.find((h) => h.id === host);

    let username = ctx.session.user?.username;
    if (host === 'local') {
      const password = flagString(flags, 'password') ?? process.env['LINEA_PASSWORD'];
      if (personal !== undefined && password === undefined) {
        // the git token of a LINEA git account is a way in as well
        username = (keepSession(ctx, (await splalm.post('/api/users/login/local/token', { token: personal })) as LoginResponse)).user.username;
      } else {
        if (personal !== undefined) throw new Error('For LINEA git give a password or a token, not both.');
        username = (await signInLocal(ctx, flagString(flags, 'username'), password === undefined ? undefined : readSecret(password))).user.username;
      }
    } else if (personal !== undefined) {
      // a token is checked by the host, and by LINEA, which must know the person (a token never makes a new one)
      let res: LoginResponse | undefined;
      try {
        res = (await splalm.post(`/api/users/login/${host}/token`, { token: personal })) as LoginResponse;
      } catch (e) {
        // a server from before this way in: what the token can still do is give this machine git access, if there is a session already
        if (!(e instanceof SplalmError && e.status === 404) || !ctx.session.authed) throw e;
      }
      if (res) username = keepSession(ctx, res).user.username;
      ctx.print(await usePersonalToken(ctx, configOf(cfg, host), personal, flagString(flags, 'username')), 'info');
      return `✓ Signed in${username ? ` as ${username}` : ''}.${modeChange(wasMode)}`;
    } else if (flags['device']) {
      if (!entry?.device) throw new Error(`This LINEA has no sign-in with a code for ${hostLabel(host)}${entry ? ' (its server is older than this CLI, or an administrator turned it off)' : ''}: use the browser (login ${host}) or a token (login ${host} --token <token or file>).`);
      const res = (await runDeviceFlow(ctx, host, 'login')) as unknown as LoginResponse;
      username = keepSession(ctx, res).user.username;
    } else {
      username = (await signIn(ctx, cfg, host)).user.username;
    }

    const git = await storeGitCredentials(ctx.session.baseUrl, { host: host as HostId });
    ctx.print(
      git
        ? `Git access to ${git} is set up too: get and push work.`
        : 'This LINEA server did not give git access (it may be older than this CLI). Give a personal access token for your git host: login --token <token or file>',
      'info',
    );
    const others = (cfg.hosts ?? []).filter((h) => h.id !== host).map((h) => h.id);
    if (others.length) ctx.print(`This LINEA also has: ${others.join(', ')}  (login <remote> to sign in with one, remote link <remote> to add an account)`, 'info');
    return `✓ Signed in as ${username} with ${hostLabel(host)}.${modeChange(wasMode)}\n${contextLine(ctx.session)}`;
  },
};

const modeChange = (was: 'server' | 'offline'): string => (was === 'offline' ? ' Mode is now: server (it was offline).' : '');

/** A password given as itself or as the path of a file that holds it. */
function readSecret(value: string): string {
  return (fs.existsSync(value) && fs.statSync(value).isFile() ? fs.readFileSync(value, 'utf8') : value).replace(/\r?\n$/, '');
}

/**
 * The user's own git token and host, from the server, kept for `git` and the registry; the name of the host, or undefined. What is kept
 * belongs to the server it came from. A token the user gave is theirs: it stays, and what the server says does not replace it; the ones
 * given for each remote are kept apart (`personal`), so that switching remotes does not lose them.
 * `host`: the remote it is for (the one in use when not said).
 */
export async function storeGitCredentials(server: string, { force = false, host }: { force?: boolean; host?: HostId } = {}): Promise<string | undefined> {
  const state = loadState();
  const wanted = host ?? (state.user?.activeHost as HostId | undefined) ?? undefined;
  const mine = wanted ? state.personal?.[wanted] : undefined;
  if (mine && mine.server === server) {
    saveState({ git: mine });
    return hostLabel(mine.provider);
  }
  const kept = state.git;
  if (!force && kept?.source === 'token' && kept.server === server && (!wanted || kept.provider === wanted)) return hostLabel(kept.provider);
  try {
    const creds = (await splalm.get(`/api/users/git-credentials${wanted ? `?host=${wanted}` : ''}`)) as Omit<StoredGit, 'server' | 'source'>;
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
  summary: 'Sign out of the LINEA server and clear what was stored for the sign-in (the mode stays)',
  usage: 'logout',
  run: async (ctx) => {
    try {
      await splalm.post('/api/users/logout');
    } catch {
      // best-effort — we clear local state regardless
    }
    configureClient({ token: '' });
    clearAuth();
    ctx.updateSession({ authed: false, expired: false, user: undefined });
    return modeOf(ctx.session) === 'server'
      ? `Signed out. Still in server mode (${shortServer(ctx.session.baseUrl)}): login to sign in again, or mode offline to work on this machine only.`
      : 'Signed out. Offline: nothing here needed the server.';
  },
};

/** Where git access comes from, in words. */
function gitAccessText(session: { baseUrl: string }): string {
  const git = storedGit();
  if (process.env['LINEA_GIT_TOKEN'] || process.env['GITLAB_TOKEN'] || process.env['GITHUB_TOKEN']) return 'from the environment';
  return git ? `${hostLabel(git.provider)} as ${git.username} (${git.source === 'token' ? 'your personal token' : 'given by LINEA'})` : `none (login, or login --token <token or file>)`;
}

const whoami: Command = {
  name: 'whoami',
  aliases: ['me', 'account'],
  summary: 'Where you are: the mode, the server, who you are, the remote you work on and the accounts you have',
  usage: 'whoami',
  run: async (ctx) => {
    const lines: string[] = [];
    const fromEnv = process.env['LINEA_BASE_URL'] ? '  (from LINEA_BASE_URL)' : '';
    if (modeOf(ctx.session) === 'server' && ctx.session.authed) {
      try {
        const res = (await splalm.post('/api/users/loginFromServiceToken')) as LoginResponse;
        configureClient({ token: res.token });
        saveState({ token: res.token, user: res.user });
        ctx.updateSession({ authed: true, expired: false, user: res.user });
        await storeGitCredentials(ctx.session.baseUrl); // the git token is renewed along with the session
      } catch (e) {
        if (!(e instanceof SessionExpiredError)) throw e;
        ctx.updateSession({ expired: true });
      }
    }
    const s = ctx.session;
    lines.push(contextLine(s));
    lines.push(`  mode:       ${modeOf(s)}${s.modeOverride ? ' (this command only)' : ''}${modeOf(s) === 'offline' ? '   this machine only: mode server connects to LINEA' : ''}`);
    lines.push(`  server:     ${s.baseUrl}${fromEnv}${modeOf(s) === 'offline' ? '   (not used while offline)' : ''}`);
    if (s.user) {
      const checked = modeOf(s) === 'server' && !s.expired;
      lines.push(`  signed in:  ${s.user.username}${checked ? '' : '   (as of the last sign in; not checked now)'}`);
      lines.push(`  remote:     ${s.user.activeHost ? hostLabel(s.user.activeHost) : 'none (none of your remotes is on)'}  (the one you work on: remote use <name>)`);
      lines.push(`  accounts:   ${(s.user.hosts ?? []).map((h) => hostLabel(h)).join(', ') || '—'}`);
    } else {
      lines.push('  signed in:  no' + (modeOf(s) === 'server' ? '   (login)' : ''));
    }
    lines.push(`  git access: ${gitAccessText(s)}`);
    return lines.join('\n');
  },
};

/** Keeps what the server says of the person's remotes, in the session and on disk. */
export function keepRemotes(ctx: CommandContext, answer: { hosts?: string[]; activeHost?: string | null }): void {
  const user = { ...(ctx.session.user ?? { userId: '', username: '' }), hosts: answer.hosts ?? [], activeHost: answer.activeHost ?? null };
  saveState({ user });
  ctx.updateSession({ user });
}

/** The old name of `remote` / `remote use`. */
const profile: Command = {
  name: 'profile',
  hidden: true,
  summary: 'Same as remote',
  usage: 'profile [gitlab|github|local]',
  run: async (ctx) => {
    const wanted = ctx.args.find((arg) => !arg.startsWith('-'));
    return commandNamed(wanted ? 'remote use' : 'remote').run(ctx);
  },
};

export const authCommands: Command[] = [login, logout, whoami, profile];
