import { onTokenRefreshed, startAutoRefresh } from './core/client.js';
import { saveState } from './core/credentials.js';
import { buildSession } from './core/session.js';
import { execute, render, type Hooks } from './commands/dispatch.js';
import { colorize } from './ui/style.js';
import type { Session } from './commands/types.js';

const KEPT = ['baseUrl', 'user', 'workdir', 'editor', 'theme', 'mode'] as const;

/** What of a session is kept between runs (the same as the interactive window keeps): only what the command changed. */
export function persistSession(patch: Partial<Session>): void {
  const kept: Record<string, unknown> = {};
  for (const key of KEPT) if (key in patch) kept[key] = patch[key];
  saveState(kept);
}

/**
 * `linea <command…>`: one command, no window. Output goes to stdout (what a program reads), notes and errors to stderr, and the exit
 * code says how it went: 0 ok, 1 failed or a check found problems, 2 used wrong.
 */
export async function runShell(argv: readonly string[], out: NodeJS.WriteStream = process.stdout, err: NodeJS.WriteStream = process.stderr): Promise<number> {
  const { session: initial, folder } = buildSession();
  let session = initial;
  onTokenRefreshed((token) => saveState({ token }));
  startAutoRefresh();

  const hooks: Hooks = {
    updateSession: (patch) => {
      session = { ...session, ...patch };
      persistSession(patch);
    },
    setStatus: (msg) => {
      if (msg && err.isTTY) err.write(`… ${msg}\n`);
    },
    print: (text, kind = 'output') => (kind === 'output' ? out : err).write(`${text}\n`),
    clear: () => {},
    exit: () => process.exit(0),
  };

  const outcome = await execute({ tokens: argv, session, folder, hooks });
  const text = render(outcome);
  // where it worked, for a command of the server: a script reading stdout (or --json) never sees it
  if (outcome.context && !outcome.json) err.write(`${colorize(outcome.context, Boolean(err.isTTY) && !process.env['NO_COLOR'])}\n`);
  // a terminal that shows colour gets the same colours as the window (not when it is data, an error or a pipe)
  const colour = Boolean(out.isTTY) && !outcome.json && !outcome.error && !process.env['NO_COLOR'];
  if (text) (outcome.error && !outcome.json ? err : out).write(`${colorize(text, colour)}\n`);
  return outcome.code;
}
