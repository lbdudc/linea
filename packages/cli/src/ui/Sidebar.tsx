import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { useKeyboard, useRenderer } from '@opentui/solid';
import { TextAttributes, type KeyEvent, type MousePointerStyle } from '@opentui/core';
import type { SidebarEntry, SidebarModel, Where } from '../core/sidebar.js';
import { clip } from './style.js';
import { theme } from './theme.js';

export const SIDEBAR_DEFAULT_WIDTH = 30;
export const SIDEBAR_MIN_WIDTH = 20;
export const SIDEBAR_MAX_WIDTH = 60;
/** the panel needs room: below this the window is all conversation */
export const SIDEBAR_MIN_COLUMNS = 110;

/** The colours `spl list` gives to where a thing is: both green, here only amber, LINEA only blue. Not signed in, nothing is told apart. */
export const whereColor = (where: Where, signedIn: boolean): string =>
  !signedIn ? theme.muted : where === 'both' ? theme.success : where === 'here' ? theme.warn : theme.info;

const whereWords: Record<Where, string> = { both: 'here + LINEA', here: 'here only', remote: 'LINEA only' };
export const whereLabel = (where: Where): string => whereWords[where];

/**
 * What makes a thing look clickable: the pointer changes over it (in the terminals that let a program ask for it) and it is
 * highlighted while the pointer is on it.
 */
export function useHover(style: MousePointerStyle = 'pointer') {
  const renderer = useRenderer();
  const [over, setOver] = createSignal(false);
  return {
    over,
    handlers: {
      onMouseOver: () => {
        setOver(true);
        renderer.setMousePointer(style);
      },
      onMouseOut: () => {
        setOver(false);
        renderer.setMousePointer('default');
      },
    },
  };
}

/** One thing of the list: a dot and a name in the colour of where it is; a click selects it. */
function Row(props: {
  entry: SidebarEntry;
  signedIn: boolean;
  inner: number;
  indent?: number;
  mark: string;
  /** the keyboard is on this one */
  cursor?: boolean;
  onSelect: (entry: SidebarEntry) => void;
}) {
  const color = () => whereColor(props.entry.where, props.signedIn);
  const hover = useHover();
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      backgroundColor={hover.over() || props.cursor ? theme.quoteBg : undefined}
      {...hover.handlers}
      onMouseDown={() => props.onSelect(props.entry)}
    >
      <text fg={theme.faint}>{' '.repeat(props.indent ?? 0)}</text>
      <text fg={props.entry.current ? theme.brand : color()}>{props.entry.current ? '▸' : '●'}</text>
      <text fg={props.entry.current ? theme.fg : color()} attributes={props.entry.current ? TextAttributes.BOLD : 0}>
        {` ${clip(props.entry.name, props.inner - (props.indent ?? 0) - 2)}`}
      </text>
      <text fg={theme.warn}>{props.mark}</text>
    </box>
  );
}

/** The heading of a group: a click folds it (and unfolds it). */
function Heading(props: { title: string; count: number; folded: boolean; onToggle: () => void }) {
  const hover = useHover();
  return (
    <box flexDirection="row" flexShrink={0} {...hover.handlers} onMouseDown={() => props.onToggle()}>
      <text fg={hover.over() ? theme.brand : theme.faint}>{`${props.folded ? '▸' : '▾'} ${props.title} (${props.count})`}</text>
    </box>
  );
}

const GROUP_MAX = 8;
const keyOf = (e: SidebarEntry): string => `${e.kind}:${e.of ?? ''}:${e.name}`;
/** The group of the list a thing belongs to (what a fold hides). */
export const groupOf = (e: SidebarEntry): string => (e.kind === 'module' ? 'Modules' : e.kind === 'metamodel' ? 'Metamodels' : 'SPLs');

/** A heading and the things under it, at most `max` of them (then `+ n more`). */
function Group(props: {
  title: string;
  entries: SidebarEntry[];
  max: number;
  signedIn: boolean;
  inner: number;
  folded: boolean;
  onToggle: () => void;
  cursor: string | undefined;
  onSelect: (entry: SidebarEntry) => void;
}) {
  return (
    <Show when={props.entries.length > 0}>
      <box flexDirection="column" flexShrink={0} marginTop={1}>
        <Heading title={props.title} count={props.entries.length} folded={props.folded} onToggle={props.onToggle} />
        <Show when={!props.folded}>
          <For each={props.entries.slice(0, props.max)}>
            {(e) => <Row entry={e} signedIn={props.signedIn} inner={props.inner} mark="" cursor={keyOf(e) === props.cursor} onSelect={props.onSelect} />}
          </For>
          <Show when={props.entries.length > props.max}>
            <text fg={theme.faint}>{`  + ${props.entries.length - props.max} more`}</text>
          </Show>
        </Show>
      </box>
    </Show>
  );
}

/**
 * The left panel: where the things are. Each is in the colour of where it is, the way `spl list` tells: here and on LINEA, only
 * here, only on LINEA. The SPL you are in is marked and its products hang under it. A click selects a thing: it goes there if it
 * is here, and its code is shown if it is only on LINEA.
 */
export interface SidebarAction {
  label: string;
  /** the keys that do the same */
  keys?: string;
  onClick: () => void;
}

export function Sidebar(props: {
  model: SidebarModel;
  changes: Record<string, number>;
  width: number;
  onSelect: (entry: SidebarEntry) => void;
  /** the buttons at the bottom */
  actions: SidebarAction[];
  /** the groups that are folded (`SPLs`, `Modules`, `Metamodels`) */
  folded: ReadonlySet<string>;
  onToggleFold: (group: string) => void;
  /** the keys are for the list: ↑ ↓ move, Enter selects, ← → or Space fold, Esc gives them back */
  focused: boolean;
  onBlur: () => void;
}) {
  const inner = () => props.width - 5;
  const mark = (name: string): string => (props.changes[name] ? ` ●${props.changes[name]}` : '');

  // what the keyboard can reach: the rows shown, in order
  const flat = createMemo((): SidebarEntry[] => {
    const out: SidebarEntry[] = [];
    if (!props.folded.has('SPLs')) {
      for (const l of props.model.lines) {
        out.push(l);
        out.push(...l.products);
      }
    }
    if (!props.folded.has('Modules')) out.push(...props.model.modules.slice(0, GROUP_MAX));
    if (!props.folded.has('Metamodels')) out.push(...props.model.metamodels.slice(0, GROUP_MAX));
    return out;
  });
  const [cursor, setCursor] = createSignal<string | undefined>();
  // taking the keys starts at the thing you are in (or the first)
  createEffect(() => {
    if (!props.focused) return;
    const list = flat();
    if (cursor() !== undefined && list.some((e) => keyOf(e) === cursor())) return;
    const start = list.find((e) => e.current) ?? list[0];
    setCursor(start ? keyOf(start) : undefined);
  });
  const shown = () => (props.focused ? cursor() : undefined);
  useKeyboard((e: KeyEvent) => {
    if (!props.focused) return;
    const list = flat();
    const at = list.findIndex((x) => keyOf(x) === cursor());
    const here = at >= 0 ? list[at] : undefined;
    if (e.name === 'down' || e.name === 'j') {
      const next = list[Math.min(list.length - 1, at + 1)];
      if (next) setCursor(keyOf(next));
    } else if (e.name === 'up' || e.name === 'k') {
      const next = list[Math.max(0, at - 1)];
      if (next) setCursor(keyOf(next));
    } else if (e.name === 'return' && here) {
      props.onSelect(here);
    } else if ((e.name === 'left' || e.name === 'right' || e.name === 'space') && here) {
      props.onToggleFold(groupOf(here));
    } else if (e.name === 'escape') {
      props.onBlur();
    }
  });
  return (
    <box flexDirection="column" flexShrink={0} width={props.width} paddingRight={1}>
      <Heading title="SPLs" count={props.model.lines.length} folded={props.folded.has('SPLs')} onToggle={() => props.onToggleFold('SPLs')} />
      <Show when={!props.folded.has('SPLs')}>
      <Show when={props.model.lines.length > 0} fallback={<text fg={theme.faint}>{'  none here yet'}</text>}>
        <For each={props.model.lines}>
          {(line) => (
            <box flexDirection="column" flexShrink={0}>
              <Row
                entry={line}
                signedIn={props.model.signedIn}
                inner={inner()}
                mark={mark(line.name)}
                cursor={keyOf(line) === shown()}
                onSelect={props.onSelect}
              />
              <For each={line.products}>
                {(p) => (
                  <Row
                    entry={p}
                    signedIn={props.model.signedIn}
                    inner={inner()}
                    indent={3}
                    mark={mark(`${line.name}/${p.name}`)}
                    cursor={keyOf(p) === shown()}
                    onSelect={props.onSelect}
                  />
                )}
              </For>
            </box>
          )}
        </For>
      </Show>
      </Show>
      <Group
        title="Modules"
        entries={props.model.modules}
        max={GROUP_MAX}
        signedIn={props.model.signedIn}
        inner={inner()}
        folded={props.folded.has('Modules')}
        onToggle={() => props.onToggleFold('Modules')}
        cursor={shown()}
        onSelect={props.onSelect}
      />
      <Group
        title="Metamodels"
        entries={props.model.metamodels}
        max={GROUP_MAX}
        signedIn={props.model.signedIn}
        inner={inner()}
        folded={props.folded.has('Metamodels')}
        onToggle={() => props.onToggleFold('Metamodels')}
        cursor={shown()}
        onSelect={props.onSelect}
      />
      <Show when={props.model.signedIn}>
        <box flexDirection="column" flexShrink={0} marginTop={1}>
          <box flexDirection="row">
            <text fg={theme.success}>{'● '}</text>
            <text fg={theme.faint}>{'here + LINEA'}</text>
          </box>
          <box flexDirection="row">
            <text fg={theme.warn}>{'● '}</text>
            <text fg={theme.faint}>{'here only'}</text>
          </box>
          <box flexDirection="row">
            <text fg={theme.info}>{'● '}</text>
            <text fg={theme.faint}>{'LINEA only'}</text>
          </box>
        </box>
      </Show>
      <box flexGrow={1} />
      <box flexDirection="column" flexShrink={0} border={['top']} borderStyle="single" borderColor={theme.border}>
        <For each={props.actions}>{(a) => <ActionRow action={a} inner={inner()} />}</For>
      </box>
    </box>
  );
}

/** A button of the bottom of the list: its words, and the keys that do the same at the right. */
function ActionRow(props: { action: SidebarAction; inner: number }) {
  const hover = useHover();
  const keys = () => (props.action.keys ? props.action.keys : '');
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      justifyContent="space-between"
      backgroundColor={hover.over() ? theme.quoteBg : undefined}
      {...hover.handlers}
      onMouseDown={() => props.action.onClick()}
    >
      <text fg={hover.over() ? theme.brand : theme.muted}>{`› ${clip(props.action.label, props.inner - keys().length - 3)}`}</text>
      <text fg={theme.faint}>{keys()}</text>
    </box>
  );
}

/** The line between panels: dragging it sideways resizes the panel next to it. It reports where the pointer is. */
export function Divider(props: { onDrag: (x: number) => void }) {
  // the pointer asks to be a "move" one over it, and the line thickens and takes the brand colour: it is something to take hold of
  const hover = useHover('move');
  const [dragging, setDragging] = createSignal(false);
  const active = () => hover.over() || dragging();
  return (
    <box
      width={1}
      flexShrink={0}
      border={['left']}
      borderStyle={active() ? 'heavy' : 'single'}
      borderColor={active() ? theme.brand : theme.border}
      {...hover.handlers}
      onMouseDown={(e) => {
        setDragging(true);
        props.onDrag(e.x);
      }}
      onMouseDrag={(e) => props.onDrag(e.x)}
      onMouseUp={() => setDragging(false)}
      onMouseDragEnd={() => setDragging(false)}
    />
  );
}
