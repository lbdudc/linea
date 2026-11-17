import path from 'node:path';
import { findContext } from '../core/context.js';
import { listLocalLines, listLocalProducts } from '../core/workspace.js';
import { defaultDataDir } from '../core/workdir.js';
import type { Session } from './types.js';

/** Where SPLs, modules and metamodels live side by side. */
export const workdirOf = (session: Session): string => session.workdir ?? defaultDataDir();

/** The SPL the commands are about: the one whose folder you are in. */
export function requireLine(session: Session): string {
  const line = findContext(session.cwd ?? process.cwd()).line;
  if (!line) throw new Error('Not inside an SPL. Go into one (cd <spl>, or in a shell cd to its folder), or bring one: get <spl>.');
  return line.dir;
}

/** A product of the SPL you are in, by name (case does not matter). */
export function resolveProductName(lineDir: string, arg: string | undefined): string {
  if (!arg) throw new Error('Name a product (or run the command inside its folder). See: product list');
  const names = listLocalProducts(lineDir).map((p) => p.name);
  const found = names.find((n) => n === arg) ?? names.find((n) => n.toLowerCase() === arg.toLowerCase());
  if (!found) throw new Error(`No product "${arg}" in ${path.basename(lineDir)}.${names.length ? ` It has: ${names.join(', ')}.` : ' See: product new'}`);
  return found;
}

/** An SPL of the workspace by name, or the one you are in. */
export function resolveLineDir(session: Session, name: string | undefined): string {
  if (!name) return requireLine(session);
  const found = listLocalLines(workdirOf(session)).find((l) => l.name.toLowerCase() === name.toLowerCase());
  if (!found) throw new Error(`No SPL "${name}" in ${workdirOf(session)}. See: spl list`);
  return found.dir;
}

export function resolveNamed(
  items: { id: string; name: string }[],
  arg: string,
  kind: string,
): { id: string } | { error: string } {
  if (/^\d+$/.test(arg)) {
    const item = items[Number(arg) - 1];
    return item ? { id: item.id } : { error: `No ${kind} #${arg}.` };
  }
  const byId = items.find((it) => it.id === arg);
  if (byId) return { id: byId.id };
  const matches = items.filter((it) => it.name.toLowerCase() === arg.toLowerCase());
  if (matches.length === 1) return { id: matches[0]!.id };
  if (matches.length === 0) return { error: `No ${kind} matching "${arg}".` };
  return { error: `Multiple ${kind}s named "${arg}" — use its number or id.` };
}
