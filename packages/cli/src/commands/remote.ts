import { flagString, parseFlags } from '../core/args.js';
import { splalm } from '../core/client.js';
import { loadState } from '../core/credentials.js';
import { hostLabel } from '../core/git.js';
import { shortServer } from '../core/mode.js';
import type { LoginResponse, PublicConfig } from '../core/types.js';
import { browserCode, hostToSignIn, keepRemotes, runDeviceFlow, storeGitCredentials, type HostId } from './auth.js';
import type { Command, CommandContext } from './types.js';

/**
 * The remotes: the git hosts this LINEA server works with (its own git, GitLab, GitHub). A person has an account on one or more, and
 * works on one at a time: the one they are "on". The server keeps that choice, so the web page and the terminal are on the same remote.
 */

/** How a remote is called when it is listed: its name, and where it is when that says something (a GitLab is somebody's). */
const nameOf = (h: { id: string; url?: string | undefined }): string => (h.id === 'local' || !h.url ? hostLabel(h.id) : `${hostLabel(h.id)} (${shortServer(h.url)})`);

const methodsOf = (h: NonNullable<PublicConfig['hosts']>[number]): string =>
  [h.id === 'local' || h.password ? 'password' : 'browser', ...(h.device ? ['code'] : []), 'token'].join(', ');

async function refresh(ctx: CommandContext): Promise<{ hosts: string[]; activeHost: string | null }> {
  const res = (await splalm.post('/api/users/loginFromServiceToken')) as LoginResponse;
  keepRemotes(ctx, { hosts: res.user.hosts ?? [], activeHost: res.user.activeHost ?? null });
  return { hosts: res.user.hosts ?? [], activeHost: res.user.activeHost ?? null };
}

const remote: Command = {
  name: 'remote',
  summary: 'The remotes of the LINEA server: which you have an account on, which one you work on, how to sign in with each',
  usage: 'remote   ·   remote use <name>   ·   remote link <name> [--device]   ·   remote unlink <name>',
  where: 'server',
  run: async (ctx) => {
    const cfg = (await splalm.get('/api/users/config')) as PublicConfig;
    const mine = await refresh(ctx);
    const hosts = cfg.hosts ?? [];
    const own = mine.hosts[0];
    const width = Math.max(...hosts.map((h) => nameOf(h).length), 8);
    const rows = hosts.map((h) => {
      const has = mine.hosts.includes(h.id);
      const on = mine.activeHost === h.id;
      const state = has ? (h.id === own ? 'your sign-in account' : 'linked') : h.id === 'local' ? 'no account (an administrator makes it)' : `not linked  → remote link ${h.id}`;
      return `  ${on ? '●' : ' '} ${nameOf(h).padEnd(width)}  ${state.padEnd(24)}  sign in with: ${methodsOf(h)}`;
    });
    return [
      `Remotes of ${shortServer(ctx.session.baseUrl)}  (● = the one you work on):`,
      ...rows,
      '',
      'Work on another: remote use <name>   ·   add an account: remote link <name>   ·   drop one: remote unlink <name>',
    ].join('\n');
  },
};

const hostArg = (ctx: CommandContext, what: string): string => {
  const name = ctx.args.find((a) => !a.startsWith('-'));
  if (!name) throw new Error(`Usage: ${what} <gitlab|github|local>`);
  return name;
};

const use: Command = {
  name: 'remote use',
  summary: 'Work on another remote (the web page follows: it is the same choice)',
  usage: 'remote use <gitlab|github|local>',
  where: 'server',
  run: async (ctx) => {
    const host = hostArg(ctx, 'remote use');
    const answer = (await splalm.put('/api/users/profile', { host })) as { hosts?: string[]; activeHost?: string | null };
    keepRemotes(ctx, answer);
    // what git is given follows the remote
    await storeGitCredentials(ctx.session.baseUrl, { force: true, host: (answer.activeHost ?? host) as HostId });
    return `✓ Working on ${hostLabel(answer.activeHost ?? host)} now (the web page too).`;
  },
};

const link: Command = {
  name: 'remote link',
  summary: 'Add your account on another remote to yours here (browser, or --device for a machine with no browser)',
  usage: 'remote link <gitlab|github> [--device]',
  flags: ['--device'],
  where: 'server',
  run: async (ctx) => {
    const { flags } = parseFlags(ctx.args, { bool: { device: undefined } });
    const host = hostArg(ctx, 'remote link');
    if (host === 'local') return '✗ LINEA git accounts are not linked: they sign in with a password (login local).';
    const cfg = (await splalm.get('/api/users/config')) as PublicConfig;
    hostToSignIn(cfg, host); // says when the server does not have it
    let answer: { hosts?: string[]; activeHost?: string | null };
    if (flags['device']) {
      answer = (await runDeviceFlow(ctx, host as HostId, 'link')) as typeof answer;
    } else {
      const { code, redirectUri } = await browserCode(ctx, cfg, host as HostId);
      answer = (await splalm.post(`/api/users/identities/${host}/native`, { code, redirect_uri: redirectUri })) as typeof answer;
    }
    keepRemotes(ctx, answer);
    return `✓ ${hostLabel(host)} account linked. Work on it with: remote use ${host}`;
  },
};

const unlink: Command = {
  name: 'remote unlink',
  summary: 'Forget your account on a remote (not the one you sign in with)',
  usage: 'remote unlink <gitlab|github>',
  where: 'server',
  run: async (ctx) => {
    const host = hostArg(ctx, 'remote unlink');
    const answer = (await splalm.del(`/api/users/identities/${host}`)) as { hosts?: string[]; activeHost?: string | null };
    const wasActive = loadState().user?.activeHost === host;
    keepRemotes(ctx, answer);
    if (wasActive) await storeGitCredentials(ctx.session.baseUrl, { force: true });
    return `✓ ${hostLabel(host)} account unlinked.${wasActive ? ` You work on ${answer.activeHost ? hostLabel(answer.activeHost) : 'none'} now.` : ''}`;
  },
};

export const remoteCommands: Command[] = [remote, use, link, unlink];
void flagString;
