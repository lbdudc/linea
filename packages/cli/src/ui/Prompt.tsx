import fs from 'node:fs';
import path from 'node:path';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import type { InputRenderable, KeyEvent } from '@opentui/core';
import { getCommand, visibleCommands } from '../commands/registry.js';
import { findContext } from '../core/context.js';
import { listLocalLines, listLocalProducts } from '../core/workspace.js';
import { commandOfTip, rankCommands, type Tip } from '../core/guide.js';
import { describePlace, placesFrom } from '../core/places.js';
import { refreshRemoteSplNames, remoteSplNames } from '../core/remote.js';
import { brief, clip } from './style.js';
import { theme } from './theme.js';

interface Suggestion {
  label: string;
  insert: string;
  token: string;
  hint?: string;
  /** the situation calls for it */
  suggested?: boolean;
}

/**
 * The commands that start with what was typed, most useful first: the ones the situation calls for (they carry the reason, in place
 * of the general description), then the everyday ones, then the rest.
 */
function commandSuggestions(prefix: string, tips: Tip[], lead = ''): Suggestion[] {
  const offered = visibleCommands();
  const byName = new Map(offered.map((c) => [c.name, c]));
  const why = new Map<string, string>();
  for (const t of tips) {
    const name = commandOfTip(t, (n) => byName.has(n));
    if (name && !why.has(name)) why.set(name, t.why);
  }
  return rankCommands(offered.map((c) => c.name).filter((n) => n.startsWith(prefix)), tips)
    .slice(0, 30)
    .map((n) => ({ label: `${lead}${n}`, insert: `${lead}${n} `, token: n, hint: why.get(n) ?? brief(byName.get(n)!.summary), suggested: why.has(n) }));
}

interface Named {
  name: string;
  hint?: string;
}

/** The products of the SPL you are in. */
function productsHere(cwd: string): Named[] {
  const line = findContext(cwd).line;
  return line ? listLocalProducts(line.dir).map((p) => ({ name: p.name, hint: `product of ${line.name}` })) : [];
}

/** Where `cd` goes, by name: the products of the SPL you are in, the SPLs of the workspace, its modules and metamodels; and `..` from inside one. */
function placesNear(cwd: string, workdir: string): Named[] {
  const folder = findContext(cwd);
  const inside = folder.product || folder.line || folder.package;
  return [...(inside ? [{ name: '..', hint: 'up one level' }] : []), ...placesFrom(cwd, workdir).map((p) => ({ name: p.name, hint: describePlace(p) }))];
}

/** What `get` can bring: what LINEA has (once it has answered) and what is here, the ones still to get first. */
function splsToGet(cwd: string, workdir: string, remote: readonly string[]): Named[] {
  const here = new Set(listLocalLines(findContext(cwd).workspace ?? workdir).map((l) => l.name));
  const onLinea = new Set(remote);
  return [
    ...remote.filter((n) => !here.has(n)).map((name) => ({ name, hint: 'LINEA only: bring it' })),
    ...remote.filter((n) => here.has(n)).map((name) => ({ name, hint: 'here + LINEA: update it' })),
    ...[...here].filter((n) => !onLinea.has(n)).map((name) => ({ name, hint: 'only here' })),
  ];
}

function namedSuggestions(cmd: string, partial: string, items: Named[], lead = ''): Suggestion[] {
  const p = partial.toLowerCase();
  const matches = items.filter((it) => it.name.toLowerCase().includes(p));
  // what starts with it comes before what only contains it
  matches.sort((x, y) => Number(y.name.toLowerCase().startsWith(p)) - Number(x.name.toLowerCase().startsWith(p)));
  return matches.slice(0, 30).map((it) => ({ label: it.name, insert: `${lead}${cmd} ${it.name} `, token: it.name, ...(it.hint ? { hint: it.hint } : {}) }));
}

function fileSuggestions(cmd: string, partial: string, lead = ''): Suggestion[] {
  const hasSep = partial.includes('/') || partial.includes('\\');
  const dir = hasSep ? path.dirname(partial) : '.';
  const base = path.basename(partial);
  const prefix = hasSep ? partial.slice(0, partial.length - base.length) : '';
  try {
    return fs
      .readdirSync(dir || '.', { withFileTypes: true })
      .filter((e) => e.name.toLowerCase().startsWith(base.toLowerCase()) && !e.name.startsWith('.'))
      .slice(0, 8)
      .map((e) => {
        const isDir = e.isDirectory();
        return {
          label: e.name + (isDir ? '/' : ''),
          insert: `${lead}${cmd} ${prefix}${e.name}${isDir ? '/' : ' '}`,
          token: e.name,
          hint: isDir ? 'dir' : 'file',
        };
      });
  } catch {
    return [];
  }
}

/**
 * What to offer for what is typed. A command is plain text (`spl list`); a leading `/` is only a way to ask for the whole menu, and is
 * kept in what is inserted when it was typed. Nothing is offered for an empty line.
 */
function buildSuggestions(value: string, tips: Tip[], where: { cwd: string; workdir: string; remote: readonly string[] }): { list: Suggestion[]; token: string } {
  const slash = value.startsWith('/');
  const lead = slash ? '/' : '';
  const text = slash ? value.slice(1) : value;
  if (!slash && text.trim() === '') return { list: [], token: '' };
  const lower = text.toLowerCase();

  // still naming the command: `spl l` and `spl ` (its verbs) as well as `sp`
  const named = commandSuggestions(lower, tips, lead);
  if (named.length) return { list: named, token: lower };

  // a whole command, then what it takes: `use gis`, `product show sh` (the command is one word or two)
  const words = text.split(' ');
  for (const n of [2, 1]) {
    if (words.length !== n + 1) continue;
    const cmd = getCommand(words.slice(0, n).join(' ').toLowerCase());
    if (!cmd?.arg) continue;
    const partial = words[n] ?? '';
    const canonical = cmd.name;
    if (cmd.arg === 'place') return { list: namedSuggestions(canonical, partial, placesNear(where.cwd, where.workdir), lead), token: partial };
    if (cmd.arg === 'spl') return { list: namedSuggestions(canonical, partial, splsToGet(where.cwd, where.workdir, where.remote), lead), token: partial };
    if (cmd.arg === 'product') return { list: namedSuggestions(canonical, partial, productsHere(where.cwd), lead), token: partial };
    return { list: fileSuggestions(canonical, partial, lead), token: partial };
  }
  return { list: [], token: '' };
}

export function Prompt(props: {
  onSubmit: (v: string) => void;
  history: string[];
  tips: Tip[];
  cwd: string;
  workdir: string;
  signedIn: boolean;
  /** the keys go elsewhere (a search in a panel) while this is false */
  focused?: boolean;
  /** put this in the line, as if it had been typed (a button that starts a command that needs a name); `id` tells a new one */
  prefill?: { text: string; id: number };
}) {
  const size = useTerminalDimensions();
  const [value, setValue] = createSignal('');
  const [sel, setSel] = createSignal(0);
  const [histIdx, setHistIdx] = createSignal(-1);
  let inputRef: InputRenderable | undefined;

  // the SPLs LINEA has are asked for in the background the first time `get ` is typed signed in, and offered when they arrive
  const [remoteTick, setRemoteTick] = createSignal(0);
  createEffect(() => {
    const v = value().replace(/^\//, '');
    if (props.signedIn && v.includes(' ') && getCommand(v.split(' ')[0]!.toLowerCase())?.arg === 'spl') {
      void refreshRemoteSplNames().then(() => setRemoteTick((t) => t + 1));
    }
  });
  const built = createMemo(() => {
    remoteTick();
    return buildSuggestions(value(), props.tips, { cwd: props.cwd, workdir: props.workdir, remote: remoteSplNames() });
  });
  // walking back through earlier commands keeps the menu closed (a recalled command would open it, and take the arrows); typing opens it again
  const suggestions = () => (histIdx() >= 0 ? [] : built().list);
  const token = () => built().token;
  const clampSel = () => (suggestions().length ? Math.min(sel(), suggestions().length - 1) : 0);

  // what we put in the line ourselves (a recalled command, an accepted suggestion): the input reports it as typed, and it is not
  let putThere: string | undefined;
  const setInput = (v: string) => {
    putThere = v;
    if (inputRef) inputRef.value = v;
    setValue(v);
  };

  let prefilled = 0;
  createEffect(() => {
    const p = props.prefill;
    if (p && p.id !== prefilled) {
      prefilled = p.id;
      setInput(p.text);
      setSel(0);
      setHistIdx(-1);
    }
  });

  const accept = (s: Suggestion) => {
    setInput(s.insert);
    setSel(0);
    setHistIdx(-1);
  };

  const recall = (dir: 1 | -1) => {
    const n = props.history.length;
    if (!n) return;
    const idx = Math.max(-1, Math.min(n - 1, histIdx() + dir));
    setHistIdx(idx);
    setInput(idx === -1 ? '' : props.history[n - 1 - idx]!);
  };

  useKeyboard((e: KeyEvent) => {
    if (props.focused === false) return;
    if (e.name === 'tab' && e.shift) return;
    if (suggestions().length > 0) {
      if (e.name === 'up') return setSel((s) => (s - 1 + suggestions().length) % suggestions().length);
      if (e.name === 'down') return setSel((s) => (s + 1) % suggestions().length);
      if (e.name === 'tab') return accept(suggestions()[clampSel()]!);
      if (e.name === 'escape') return setInput('');
    } else {
      if (e.name === 'up') return recall(1);
      if (e.name === 'down') return recall(-1);
      if (e.name === 'escape') return setInput('');
    }
  });

  const handleSubmit = (v: string) => {
    if (suggestions().length > 0) {
      const chosen = suggestions()[clampSel()]!;
      if (chosen.token.toLowerCase() !== token().toLowerCase()) return accept(chosen);
    }
    setInput('');
    setSel(0);
    setHistIdx(-1);
    props.onSubmit(v);
  };

  const ROWS = 8;
  const start = () => Math.max(0, Math.min(clampSel() - Math.floor(ROWS / 2), suggestions().length - ROWS));
  const visible = () => suggestions().slice(start(), start() + ROWS);
  const labelWidth = () => Math.min(26, Math.max(...visible().map((x) => x.label.length), 8));
  const placeholder = () => {
    const first = props.tips[0]?.command;
    return first ? `Try "${first}"  ·  type / for commands` : 'type / for commands';
  };

  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" border borderStyle="rounded" borderColor={value().startsWith('/') ? theme.brand : theme.border} paddingLeft={1} paddingRight={1}>
        <text fg={theme.brand}>{'❯ '}</text>
        <input
          ref={(el) => (inputRef = el)}
          focused={props.focused !== false}
          flexGrow={1}
          placeholder={placeholder()}
          onInput={(v) => {
            setValue(v);
            // the echo of our own change must not end the walk through history (or the choice of a suggestion)
            if (v === putThere) return;
            putThere = undefined;
            setSel(0);
            setHistIdx(-1);
          }}
          onSubmit={() => handleSubmit(value())}
        />
      </box>
      <Show when={suggestions().length > 0}>
        <box flexDirection="column" paddingLeft={2} paddingTop={0}>
          <For each={visible()}>
            {(s, i) => {
              const selected = () => start() + i() === clampSel();
              return (
                <box flexDirection="row">
                  <text fg={selected() ? theme.brand : theme.faint}>{selected() ? '› ' : '  '}</text>
                  <text fg={selected() ? theme.brand : s.suggested ? theme.fg : theme.muted}>{s.label.padEnd(labelWidth() + 2)}</text>
                  <text fg={selected() ? theme.fg : theme.faint}>{clip(s.hint ?? '', Math.max(10, size().width - labelWidth() - 10))}</text>
                </box>
              );
            }}
          </For>
          <text fg={theme.faint}>
            {`  ${suggestions().length > ROWS ? `${clampSel() + 1}/${suggestions().length} · ` : ''}↑↓ select · Tab complete · Enter run · Esc clear`}
          </text>
        </box>
      </Show>
    </box>
  );
}
