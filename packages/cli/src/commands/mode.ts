import { configureClient, splalm } from '../core/client.js';
import { clearAuth, saveState } from '../core/credentials.js';
import { contextLine, modeOf, shortServer } from '../core/mode.js';
import { commandNamed } from './lookup.js';
import type { PublicConfig } from '../core/types.js';
import type { Command, CommandContext } from './types.js';

/**
 * What linea is working with: the LINEA server (`server`), or only this machine (`offline`). It is chosen, kept, and shown wherever
 * you look (status bar, welcome, the line a command of the server prints, `whoami`): nothing switches it for you.
 */

const mode: Command = {
  name: 'mode',
  summary: 'Show or choose the mode: server (the LINEA server) or offline (this machine only)',
  usage: 'mode [server|offline]',
  run: ({ args, session, updateSession }) => {
    const wanted = args.find((a) => !a.startsWith('-'));
    if (!wanted) {
      return [
        contextLine(session),
        '  server:   the LINEA server and its remotes: your SPLs there, push, pipelines  (mode server)',
        '  offline:  this machine only: SPLs in folders, generate here, no server asked  (mode offline)',
        `  now:      ${modeOf(session)}${session.modeOverride ? ' (this command only)' : ''}   ·   server: ${shortServer(session.baseUrl)}   ·   --offline works for one command`,
      ].join('\n');
    }
    if (wanted !== 'server' && wanted !== 'offline') return 'Usage: mode [server|offline]';
    updateSession({ mode: wanted, modeOverride: false });
    saveState({ mode: wanted });
    if (wanted === 'offline') return `✓ Offline: this machine only; the server is not asked. mode server to connect again.`;
    return session.authed
      ? `✓ Server mode.\n${contextLine({ ...session, mode: 'server', modeOverride: false })}`
      : `✓ Server mode (${shortServer(session.baseUrl)}). You are not signed in: login [remote]`;
  },
};

const online: Command = { name: 'online', hidden: true, summary: 'Same as mode server', run: (ctx) => commandNamed('mode').run({ ...ctx, args: ['server'] }) };
const offline: Command = { name: 'offline', hidden: true, summary: 'Same as mode offline', run: (ctx) => commandNamed('mode').run({ ...ctx, args: ['offline'] }) };

/** An address with its scheme: `linea.example.org` is https, `localhost` and addresses with a port on the machine are http. */
export function normalizeServer(given: string): string {
  const withScheme = /^https?:\/\//.test(given) ? given : /^(localhost|127\.|\[::1\])/.test(given) ? `http://${given}` : `https://${given}`;
  return withScheme.replace(/\/+$/, '');
}

const server: Command = {
  name: 'server',
  summary: 'The LINEA server: show it and the remotes it has, or point linea at another one (that signs you out)',
  usage: 'server [url] [--yes]',
  flags: ['--yes'],
  run: async (ctx: CommandContext) => {
    const given = ctx.args.find((a) => !a.startsWith('-'));
    if (!given) {
      const lines = [contextLine(ctx.session), `  server:   ${ctx.session.baseUrl}${process.env['LINEA_BASE_URL'] ? '  (from LINEA_BASE_URL)' : ''}`];
      try {
        const cfg = (await splalm.get('/api/users/config')) as PublicConfig;
        lines.push('  reachable: yes');
        lines.push(`  remotes:  ${(cfg.hosts ?? []).map((h) => `${h.id}${h.id === cfg.primary ? ' (primary)' : ''}`).join(', ') || '—'}`);
      } catch {
        lines.push('  reachable: no   (check the address; mode offline works without it)');
      }
      return lines.join('\n');
    }
    const baseUrl = normalizeServer(given);
    if (baseUrl === ctx.session.baseUrl.replace(/\/+$/, '')) return `Already on ${baseUrl}.`;
    if (ctx.session.authed && !ctx.args.includes('--yes')) {
      return `✗ Changing the server signs you out of ${shortServer(ctx.session.baseUrl)}. Run it again with --yes: server ${given} --yes`;
    }
    try {
      if (ctx.session.authed) await splalm.post('/api/users/logout');
    } catch {
      /* best effort */
    }
    configureClient({ baseUrl, token: '' });
    clearAuth();
    saveState({ baseUrl, mode: 'server' });
    ctx.updateSession({ baseUrl, mode: 'server', authed: false, expired: false, user: undefined });
    return `✓ Server: ${baseUrl}. Signed out; mode is server. login [remote] to sign in.`;
  },
};

export const modeCommands: Command[] = [mode, online, offline, server];
