import type { Session } from '../commands/types.js';
import { hostLabel } from './git.js';

export type Mode = 'server' | 'offline';

/** The mode a session is in; a session made without one is server when signed in and offline when not. */
export const modeOf = (session: Pick<Session, 'mode' | 'authed'>): Mode => session.mode ?? (session.authed ? 'server' : 'offline');

/** In server mode, signed in: what has a server side goes to the server. */
export const online = (session: Pick<Session, 'mode' | 'authed'>): boolean => modeOf(session) === 'server' && session.authed;

/** The address as a person reads it: no scheme, no trailing slash. */
export const shortServer = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

/** The remote the person is working on (the profile), by name: `GitLab`, `GitHub`, `LINEA git`. */
export const remoteOf = (session: Pick<Session, 'user'>): string | undefined => (session.user?.activeHost ? hostLabel(session.user.activeHost) : undefined);

/**
 * One line that says where you are: the mode, the server, the remote and who you are. The same words in the status bar, the welcome,
 * the header a command prints and `whoami`. `short` is for the status bar.
 */
export function contextLine(session: Session, { short = false }: { short?: boolean } = {}): string {
  if (modeOf(session) === 'offline') {
    return session.modeOverride ? '○ offline (this command) · this machine only' : short ? '○ offline' : '○ offline · this machine only';
  }
  const server = shortServer(session.baseUrl);
  if (!session.authed) return short ? '◐ not signed in' : `◐ server ${server} · not signed in (login)`;
  if (session.expired) return short ? '◐ session expired' : `◐ server ${server} · session expired (login)`;
  const who = session.user?.username;
  const remote = remoteOf(session);
  if (short) return `● ${[remote, who].filter(Boolean).join(' · ') || 'server'}`;
  return `● server ${server} · ${remote ? `${remote} as ` : 'signed in as '}${who ?? '?'}`;
}

/** Why a command that needs the LINEA server cannot go on, and what to do: switch the mode, or sign in. */
export function needsServerText(what: string, session: Pick<Session, 'mode' | 'authed' | 'baseUrl'>): string {
  return modeOf(session) === 'offline'
    ? `✗ ${what} needs the LINEA server, and linea is offline (this machine only). Switch: mode server`
    : `✗ ${what} needs you signed in to ${shortServer(session.baseUrl)}: login [remote]  (or --offline to work on this machine)`;
}
