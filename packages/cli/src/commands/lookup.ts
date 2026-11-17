import type { Command } from './types.js';

/**
 * How a command finds another one by name. The registry sets it once it has built its table, so a command that is a thin front for
 * another (`spl list` for `lines`) does not import the registry, which imports it.
 */
let find: (name: string) => Command | undefined = () => undefined;

export function setLookup(fn: (name: string) => Command | undefined): void {
  find = fn;
}

export function commandNamed(name: string): Command {
  const cmd = find(name);
  if (!cmd) throw new Error(`Internal: no command "${name}".`);
  return cmd;
}
