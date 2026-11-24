import type { Command } from './types.js';
import { allCommands, getCommand, visibleCommands } from './registry.js';
import { guideState, tipsFor, commandOfTip, EVERYDAY } from '../core/guide.js';
import { brief } from '../ui/style.js';
import { KEYS_HELP } from '../ui/keys.js';

/** The order the groups are shown in; anything else follows alphabetically under "other". */
const GROUPS: { title: string; names: string[] }[] = [
  { title: 'Account, server and mode', names: ['whoami', 'login', 'logout', 'remote', 'mode', 'server', 'config', 'init', 'doctor'] },
  { title: 'LINEA ⇄ your machine', names: ['get', 'status', 'push'] },
  { title: 'Open', names: ['open'] },
  { title: 'SPLs', names: ['cd', 'spl', 'check'] },
  { title: 'Feature model', names: ['fm'] },
  { title: 'Products', names: ['product', 'generate'] },
  { title: 'Modules and metamodels', names: ['module', 'metamodel', 'publish'] },
  { title: 'On the server', names: ['reconcile', 'namespaces'] },
];

/** Usage as it is typed in a shell or in the window: with no leading slash (the window takes it either way). */
export const usageOf = (c: Command): string => (c.usage ?? c.name).replace(/(^|\s)\/(?=[a-z])/g, '$1');

const noun = (c: Command): string => c.name.split(' ')[0]!;

const detail = (c: Command): string[] => {
  const lines = [`${c.name} — ${c.summary}`];
  if (c.usage) lines.push(`  usage: ${usageOf(c)}`);
  if (c.flags?.length) lines.push(`  flags: ${c.flags.join('  ')}`);
  if (c.aliases?.length) lines.push(`  aliases: ${c.aliases.join(', ')}`);
  const where = c.where ?? (c.requiresAuth ? 'server' : 'machine');
  if (where === 'server') lines.push('  needs the LINEA server: server mode, signed in (mode server, login)');
  else if (where === 'both') lines.push('  works on the LINEA server (server mode) or on this machine (offline), by the mode you are in');
  return lines;
};

/** Markdown of every command, for the README: `linea help --markdown`. */
export function commandReference(): string {
  const rows = visibleCommands().map((c) => `| \`${usageOf(c).replace(/\|/g, '\\|')}\` | ${c.summary.replace(/\|/g, '\\|')} |`);
  return ['| Command | What it does |', '| --- | --- |', ...rows].join('\n');
}

const help: Command = {
  name: 'help',
  aliases: ['h'],
  summary: 'List the commands, or explain one (help spl, help product new)',
  usage: 'help [command]',
  run: ({ args, session }) => {
    if (args.includes('--markdown')) return commandReference();
    if (args.length) {
      const words = args.map((a) => a.replace(/^\//, '').toLowerCase());
      const exact = getCommand(words.join(' ')) ?? getCommand(words[0]!);
      const family = allCommands().filter((c) => c.name.startsWith(`${words[0]} `));
      if (exact && !(words.length === 1 && family.length)) return detail(exact).join('\n');
      if (family.length) return [`${words[0]}:`, ...family.map((c) => `  ${c.name.padEnd(20)} ${c.summary}`)].join('\n');
      return `Unknown command: ${words.join(' ')}`;
    }

    const shown = visibleCommands();
    const names = new Set(shown.map((c) => c.name));
    const byName = new Map(shown.map((c) => [c.name, c]));
    const state = guideState(session);
    const tips = tipsFor(state);
    const out: string[] = [];
    const listed = new Set<string>();

    // 1. what makes sense where you are, in the order to do it
    const where = state.product ? `in the product ${state.product.name}` : state.line ? `in the SPL ${state.line.name}` : state.pkg ? `in the ${state.pkg.kind} ${state.pkg.name}` : 'outside an SPL';
    out.push(`Start here (${where}):`);
    const width = Math.min(34, Math.max(...tips.map((t) => t.command.length)) + 2);
    for (const t of tips) {
      out.push(`  ${t.command.padEnd(width)}${t.why}`);
      const name = commandOfTip(t, (n) => names.has(n));
      if (name) listed.add(name);
    }

    // 2. what people do every day
    const everyday = EVERYDAY.filter((n) => names.has(n) && !listed.has(n));
    if (everyday.length) {
      out.push('', 'Every day:');
      for (const n of everyday) {
        listed.add(n);
        out.push(`  ${n.padEnd(width)}${brief(byName.get(n)!.summary)}`);
      }
    }

    // 3. the rest, by what they are about
    const rest = shown.filter((c) => !listed.has(c.name));
    const used = new Set<string>();
    const section = (title: string, cmds: Command[]) => {
      if (!cmds.length) return;
      out.push('', `${title}:`);
      for (const c of cmds) {
        used.add(c.name);
        out.push(`  ${c.name.padEnd(width)}${c.summary}`);
      }
    };
    for (const g of GROUPS) {
      section(g.title, rest.filter((c) => g.names.includes(noun(c))).sort((a, b) => g.names.indexOf(noun(a)) - g.names.indexOf(noun(b)) || a.name.localeCompare(b.name)));
    }
    section('Other', rest.filter((c) => !used.has(c.name)).sort((a, b) => a.name.localeCompare(b.name)));
    out.push('', 'help <command> explains one (help product new) · ? lists the keys · Ctrl+C or /exit to quit.');
    return out.join('\n');
  },
};

const keys: Command = {
  name: 'keys',
  aliases: ['?'],
  summary: 'Show keyboard shortcuts',
  usage: 'keys',
  run: () => KEYS_HELP,
};

const clear: Command = {
  name: 'clear',
  aliases: ['cls'],
  summary: 'Clear the screen',
  run: ({ clear: doClear }) => {
    doClear();
    return '';
  },
};

const exit: Command = {
  name: 'exit',
  aliases: ['quit', 'q'],
  summary: 'Quit linea',
  run: ({ exit: doExit }) => {
    doExit();
    return 'Bye.';
  },
};

export const helpCommands: Command[] = [help, keys, clear, exit];
