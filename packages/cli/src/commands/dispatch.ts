import { handleApiError } from '../core/client.js';
import type { FolderContext } from '../core/context.js';
import { resolveCommand } from './registry.js';
import type { CommandContext, Session } from './types.js';

export type Hooks = Pick<CommandContext, 'updateSession' | 'setStatus' | 'print' | 'clear' | 'exit' | 'dialog'>;

export interface Outcome {
  /** 0 ok · 1 it failed (or a check found problems) · 2 it was used wrong */
  code: 0 | 1 | 2;
  text: string;
  /** the command did not run or threw: `text` is the reason (for stderr), not a result */
  error?: true;
  data?: unknown;
  json: boolean;
}

/** The words with the global flags taken out, and which of them were there. */
export function splitGlobals(tokens: readonly string[]): { rest: string[]; json: boolean; local: boolean } {
  return { rest: tokens.filter((t) => t !== '--json' && t !== '--local'), json: tokens.includes('--json'), local: tokens.includes('--local') };
}

const firstPositional = (args: readonly string[]): string | undefined => args.find((a) => !a.startsWith('-'));

/** Runs a line of words as a command: what both the interactive window and `linea <words>` do. */
export async function execute(opts: {
  tokens: readonly string[];
  session: Session;
  folder?: FolderContext;
  hooks: Hooks;
  /** gives the command up (see `cancellable`) */
  signal?: AbortSignal;
}): Promise<Outcome> {
  const { rest, json, local } = splitGlobals(opts.tokens);
  const session: Session = { ...opts.session, ...(json ? { json } : {}), ...(local ? { local } : {}) };

  const resolved = resolveCommand(rest);
  if ('error' in resolved) return { code: 2, text: resolved.error, error: true, json };
  const { cmd } = resolved;
  let { args } = resolved;

  if (cmd.requiresAuth && !session.authed) {
    return { code: 1, text: `${cmd.name} needs you signed in: run login`, error: true, json };
  }

  // standing in a product, the product is the one meant
  if (cmd.arg === 'product' && opts.folder?.product && !firstPositional(args)) args = [opts.folder.product.name, ...args];

  let data: unknown;
  const ctx: CommandContext = {
    ...opts.hooks,
    session,
    args,
    rest: args.join(' '),
    ...(opts.signal ? { signal: opts.signal } : {}),
    data: (v) => {
      data = v;
    },
  };
  // a command that changes the session (cd, spl new) changes the one it was given too, so the rest of the line sees it
  const update = opts.hooks.updateSession;
  ctx.updateSession = (patch) => {
    ctx.session = { ...ctx.session, ...patch };
    update(patch);
  };

  try {
    const text = String(await cmd.run(ctx));
    const failed = /^[✗]/.test(text.trimStart());
    const usage = /^Usage:/.test(text);
    return {
      code: usage ? 2 : failed ? 1 : 0,
      text,
      ...(usage ? { error: true as const } : {}),
      ...(data !== undefined ? { data } : {}),
      json,
    };
  } catch (err) {
    return { code: 1, text: handleApiError(err), error: true, json };
  }
}

/** What to print for an outcome: JSON when it was asked for and the command has data; otherwise the text. */
export function render(outcome: Outcome): string {
  if (outcome.json) return JSON.stringify(outcome.data !== undefined ? outcome.data : { ok: outcome.code === 0, message: outcome.text }, null, 2);
  return outcome.text;
}
