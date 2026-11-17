import type { Command } from './types.js';
import { helpCommands } from './help.js';
import { authCommands } from './auth.js';
import { configCommands } from './config.js';
import { fmCommands } from './fm.js';
import { splCommands } from './spl.js';
import { productCommands } from './product.js';
import { serverCommands } from './server.js';
import { moduleCommands } from './modules.js';
import { gitCommands } from './git.js';
import { bridgeCommands } from './bridge.js';
import { packageCommands } from './packages.js';
import { catalogCommands } from './catalog.js';
import { workflowCommands } from './workflow.js';
import { openCommands } from './open.js';
import { systemCommands } from './system.js';
import { setupCommands } from './setup.js';
import { setLookup } from './lookup.js';

const commands: Command[] = [
  ...helpCommands,
  ...authCommands,
  ...configCommands,
  ...setupCommands,
  ...bridgeCommands,
  ...workflowCommands,
  ...splCommands,
  ...moduleCommands,
  ...fmCommands,
  ...productCommands,
  ...packageCommands,
  ...catalogCommands,
  ...gitCommands,
  ...openCommands,
  ...systemCommands,
  ...serverCommands,
];

const byName = new Map<string, Command>();
for (const cmd of commands) {
  byName.set(cmd.name, cmd);
  for (const alias of cmd.aliases ?? []) byName.set(alias, cmd);
}
setLookup((name) => byName.get(name));

export function getCommand(name: string): Command | undefined {
  return byName.get(name);
}

export function allCommands(): Command[] {
  return commands;
}

/** The commands that are listed (help, completion): the ones that are not folded into another. */
export function visibleCommands(): Command[] {
  return commands.filter((c) => !c.hidden);
}

/** The nouns commands are grouped under: `spl list`, `product models`… */
export const NOUNS = [...new Set(commands.filter((c) => c.name.includes(' ')).map((c) => c.name.split(' ')[0]!))];

/**
 * The command a line of words means: the longest name wins (`spl list` before `spl`). Returns what is left as its arguments, or an
 * error when the first word is a noun and the second is not one of its verbs.
 */
export function resolveCommand(tokens: readonly string[]): { cmd: Command; args: string[] } | { error: string } {
  const [first, second] = tokens.map((t) => t.toLowerCase());
  if (!first) return { error: 'Type a command. help lists them.' };
  if (second) {
    const two = byName.get(`${first} ${second}`);
    if (two) return { cmd: two, args: tokens.slice(2) as string[] };
  }
  if (NOUNS.includes(first) && !byName.has(first)) {
    const verbs = commands.filter((c) => !c.hidden && c.name.startsWith(`${first} `)).map((c) => c.name);
    return { error: second && !second.startsWith('-') ? `Unknown: ${first} ${second}. Try: ${verbs.join(', ')}.` : `${first} what? ${verbs.join(', ')}` };
  }
  const one = byName.get(first);
  if (!one) return { error: `Unknown command: ${first}. Type help.` };
  return { cmd: one, args: tokens.slice(1) as string[] };
}
