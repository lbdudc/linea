import path from 'node:path';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { TextAttributes, type KeyEvent, type ScrollBoxRenderable } from '@opentui/core';
import {
  changedFilesOf,
  diffOf,
  grepLocal,
  listFilesOf,
  matchFiles,
  readFileOf,
  rowsOf,
  type CodeTarget,
  type FileChange,
  type FileText,
  type Hit,
} from '../core/codeview.js';
import { clip } from './style.js';
import { theme } from './theme.js';

export const CODE_DEFAULT_WIDTH = 56;
export const CODE_MIN_WIDTH = 30;
export const CODE_MAX_WIDTH = 120;
const MAX_LINES = 1500;

/** The file to open first: the one that says what the thing is. */
const FIRST = ['spl.json', '.linea/module.json', 'metamodel.json', 'package.json', 'README.md'];

/**
 * The right panel: the files of the thing selected (an SPL, product, module or metamodel) and the file you pick. From its folder
 * when it is here, from its repository on the git host when it is not. It only looks: `open` and the editor are for changing.
 * A search (Ctrl+F) finds files by name and, for what is here, lines by their text.
 */
export function CodePanel(props: {
  target: CodeTarget | undefined;
  width: number;
  /** the command that brings it here, when it is only on the host */
  action?: { label: string; command: string };
  onAction: (command: string) => void;
  /** more buttons by the title: the page of it, its folder */
  tools?: { label: string; command: string }[];
  onClose: () => void;
  /** the search has the keys (the prompt does not) */
  searching: boolean;
  onSearching: (on: boolean) => void;
  /** open a file of what is shown in the editor (the full path) */
  onEdit?: (file: string) => void;
}) {
  const inner = () => props.width - 2;
  const [files, setFiles] = createSignal<string[]>([]);
  const [open, setOpen] = createSignal<ReadonlySet<string>>(new Set<string>());
  const [error, setError] = createSignal<string | undefined>();
  const [loading, setLoading] = createSignal(false);
  const [picked, setPicked] = createSignal<string | undefined>();
  const [content, setContent] = createSignal<FileText | undefined>();
  const [query, setQuery] = createSignal('');
  const [hits, setHits] = createSignal<Hit[]>([]);
  const [highlight, setHighlight] = createSignal('');
  // what is not as the last commit has it (a folder here only), and the diff of the file shown when it is asked for
  const [changes, setChanges] = createSignal<ReadonlyMap<string, FileChange>>(new Map());
  const [diff, setDiff] = createSignal<string | undefined>();
  const [diffOn, setDiffOn] = createSignal(false);
  let run = 0;
  let viewer: ScrollBoxRenderable | undefined;

  const pick = async (target: CodeTarget, rel: string, line?: number, mine = run) => {
    setPicked(rel);
    setContent(undefined);
    setDiffOn(false);
    setDiff(undefined);
    try {
      const text = await readFileOf(target, rel);
      if (mine === run && picked() === rel) {
        setContent(text);
        if (viewer) viewer.scrollTo(line ? Math.max(0, line - 4) : 0);
      }
    } catch (e) {
      if (mine === run) setContent({ text: `(${(e as Error).message.split('\n')[0]})`, truncated: false, binary: false });
    }
  };

  const load = async (target: CodeTarget) => {
    const mine = ++run;
    setLoading(true);
    setError(undefined);
    setFiles([]);
    setOpen(new Set<string>());
    setPicked(undefined);
    setContent(undefined);
    setQuery('');
    setHits([]);
    setChanges(new Map());
    setDiffOn(false);
    setDiff(undefined);
    try {
      const found = await listFilesOf(target);
      if (mine !== run) return;
      setFiles(found);
      if (target.kind === 'local') {
        void changedFilesOf(target.dir).then((c) => {
          if (mine === run) setChanges(c);
        });
      }
      const first = FIRST.find((f) => found.includes(f));
      if (first) await pick(target, first, undefined, mine);
    } catch (e) {
      if (mine === run) setError((e as Error).message.split('\n')[0] ?? 'could not read it');
    } finally {
      if (mine === run) setLoading(false);
    }
  };

  createEffect(() => {
    const target = props.target;
    if (target) void load(target);
  });

  // what the search finds: files by name at once, and the text of the files (what is here) as it is read
  const nameMatches = createMemo(() => matchFiles(files(), query()));
  let searchRun = 0;
  createEffect(() => {
    const q = query().trim();
    const target = props.target;
    const mine = ++searchRun;
    setHits([]);
    if (q.length < 3 || !target || target.kind !== 'local') return;
    const all = files();
    // typing goes on while it looks: only the last question is answered
    setTimeout(() => {
      if (mine !== searchRun) return;
      void grepLocal(target.dir, all, q, () => mine === searchRun).then((found) => {
        if (mine === searchRun) setHits(found);
      });
    }, 150);
  });

  useKeyboard((e: KeyEvent) => {
    if (!props.searching) return;
    if (e.name === 'escape') {
      setQuery('');
      props.onSearching(false);
    } else if (e.name === 'return') {
      // Enter takes the first thing found
      const t = props.target;
      const first = nameMatches()[0];
      const hit = hits()[0];
      if (t && first) {
        setHighlight('');
        void pick(t, first);
      } else if (t && hit) {
        setHighlight(query().trim());
        void pick(t, hit.path, hit.line);
      }
      props.onSearching(false);
    }
  });

  const rows = createMemo(() => rowsOf(files(), open()));
  const changeOfPicked = () => {
    const p = picked();
    return p ? changes().get(p) : undefined;
  };
  const showDiff = () => diffOn() && diff() !== undefined;
  const lines = createMemo(() => (showDiff() ? diff()! : (content()?.text ?? '')).split('\n').slice(0, MAX_LINES));
  const cut = () => !showDiff() && (Boolean(content()?.truncated) || (content()?.text.split('\n').length ?? 0) > MAX_LINES);
  const toggleDiff = () => {
    const t = props.target;
    const rel = picked();
    const change = changeOfPicked();
    if (!t || t.kind !== 'local' || !rel || !change) return;
    if (diffOn()) return setDiffOn(false);
    setDiffOn(true);
    if (diff() === undefined) void diffOf(t.dir, rel, change).then((text) => rel === picked() && setDiff(text || '(no changes to show)'));
  };
  const edit = () => {
    const t = props.target;
    const rel = picked();
    if (t && t.kind === 'local' && rel) props.onEdit?.(path.join(t.dir, ...rel.split('/')));
  };
  /** the mark of a row of the tree: a file that changed, or a folder that has one inside */
  const markOf = (p: string, dir: boolean): FileChange | undefined => {
    const all = changes();
    if (all.size === 0) return undefined;
    if (!dir) return all.get(p);
    const prefix = `${p}/`;
    for (const [f, c] of all) if (f.startsWith(prefix)) return c;
    return undefined;
  };
  const markColor = (c: FileChange): string => (c === 'new' ? theme.success : c === 'deleted' ? theme.error : theme.warn);
  const lineColor = (line: string): string => {
    if (!showDiff()) return theme.fg;
    return line.startsWith('+') ? theme.success : line.startsWith('-') ? theme.error : line.startsWith('@@') ? theme.info : theme.fg;
  };
  const searchingNow = () => query().trim().length > 0;
  const isLocal = () => props.target?.kind === 'local';
  const repo = () => {
    const t = props.target;
    return t && t.kind === 'remote' ? t.repo : undefined;
  };
  const toggle = (p: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(p)) next.add(p);
      return next;
    });
  const treeHeight = () => Math.min(14, Math.max(2, searchingNow() ? nameMatches().length + hits().length + 1 : rows().length));

  return (
    <box flexDirection="column" flexShrink={0} width={props.width} paddingLeft={1}>
      <box flexDirection="row" flexShrink={0} justifyContent="space-between">
        <text fg={theme.brand} attributes={TextAttributes.BOLD}>
          {clip(props.target?.title ?? 'Code', Math.max(8, inner() - 12 - (props.tools ?? []).reduce((n, t) => n + t.label.length + 3, 0)))}
        </text>
        <box flexDirection="row" flexShrink={0}>
          <For each={props.tools ?? []}>
            {(tool) => (
              <text fg={theme.muted} onMouseDown={() => props.onAction(tool.command)}>
                {`[${tool.label}] `}
              </text>
            )}
          </For>
          <Show when={props.action}>
            <text fg={theme.info} onMouseDown={() => props.onAction(props.action!.command)}>
              {`[${props.action!.label}] `}
            </text>
          </Show>
          <text fg={theme.faint} onMouseDown={() => props.onClose()}>
            {'[x]'}
          </text>
        </box>
      </box>
      <Show when={props.target} fallback={<text fg={theme.faint}>{'Click an SPL, product, module or metamodel to see its code.'}</text>}>
        <Show when={repo()}>
          <text fg={theme.faint}>{`on the git host · ${clip(repo() ?? '', inner() - 16)}`}</text>
        </Show>
        <box flexDirection="row" flexShrink={0} onMouseDown={() => props.onSearching(true)}>
          <text fg={props.searching ? theme.brand : theme.faint}>{'⌕ '}</text>
          <Show
            when={props.searching}
            fallback={<text fg={query() ? theme.fg : theme.faint}>{query() || 'search files (Ctrl+F)'}</text>}
          >
            <input
              focused
              flexGrow={1}
              placeholder="file name or text…"
              value={query()}
              onInput={(v) => setQuery(v)}
            />
          </Show>
        </box>
        <Show when={error()}>
          <text fg={theme.error}>{clip(error() ?? '', inner())}</text>
        </Show>
        <Show when={loading() && files().length === 0}>
          <text fg={theme.faint}>{'reading…'}</text>
        </Show>
        <scrollbox height={treeHeight()} flexShrink={0} marginTop={1} verticalScrollbarOptions={{ visible: false }}>
          <Show
            when={searchingNow()}
            fallback={
              <For each={rows()}>
                {(r) => (
                  <box
                    flexDirection="row"
                    flexShrink={0}
                    onMouseDown={() => {
                      const t = props.target;
                      if (r.dir) toggle(r.path);
                      else if (t) {
                        setHighlight('');
                        void pick(t, r.path);
                      }
                    }}
                  >
                    <text fg={theme.faint}>{'  '.repeat(r.depth)}</text>
                    <text
                      fg={r.dir ? theme.muted : picked() === r.path ? theme.brand : theme.fg}
                      attributes={picked() === r.path ? TextAttributes.BOLD : 0}
                    >
                      {`${r.dir ? (open().has(r.path) ? '▾ ' : '▸ ') : '  '}${clip(r.name, inner() - r.depth * 2 - 4)}`}
                    </text>
                    <Show when={markOf(r.path, r.dir)}>
                      <text fg={markColor(markOf(r.path, r.dir)!)}>{' ●'}</text>
                    </Show>
                  </box>
                )}
              </For>
            }
          >
            <For each={nameMatches()}>
              {(f) => (
                <text
                  fg={picked() === f ? theme.brand : theme.fg}
                  onMouseDown={() => {
                    const t = props.target;
                    if (t) {
                      setHighlight('');
                      void pick(t, f);
                    }
                  }}
                >
                  {clip(f, inner())}
                </text>
              )}
            </For>
            <For each={hits()}>
              {(h) => (
                <text
                  fg={theme.muted}
                  onMouseDown={() => {
                    const t = props.target;
                    if (t) {
                      setHighlight(query().trim());
                      void pick(t, h.path, h.line);
                    }
                  }}
                >
                  {clip(`${h.path}:${h.line}  ${h.text}`, inner())}
                </text>
              )}
            </For>
            <Show when={nameMatches().length === 0 && hits().length === 0}>
              <text fg={theme.faint}>{'nothing found'}</text>
            </Show>
          </Show>
        </scrollbox>
        <Show when={picked()}>
          <box flexDirection="column" flexGrow={1} marginTop={1} border={['top']} borderStyle="single" borderColor={theme.border}>
            <box flexDirection="row" flexShrink={0} justifyContent="space-between">
              <text fg={changeOfPicked() ? markColor(changeOfPicked()!) : theme.faint}>
                {clip(picked() ?? '', Math.max(8, inner() - (isLocal() ? 16 : 0)))}
              </text>
              <Show when={isLocal()}>
                <box flexDirection="row" flexShrink={0}>
                  <Show when={changeOfPicked()}>
                    <text fg={diffOn() ? theme.brand : theme.muted} onMouseDown={toggleDiff}>
                      {diffOn() ? '[file] ' : '[diff] '}
                    </text>
                  </Show>
                  <text fg={theme.muted} onMouseDown={edit}>
                    {'[edit]'}
                  </text>
                </box>
              </Show>
            </box>
            <Show when={content()?.binary && !showDiff()}>
              <text fg={theme.faint}>{'(not a text file)'}</text>
            </Show>
            <scrollbox ref={(el: ScrollBoxRenderable) => (viewer = el)} flexGrow={1} verticalScrollbarOptions={{ visible: false }}>
              <For each={lines()}>
                {(line, i) => {
                  const found = () => highlight() !== '' && line.toLowerCase().includes(highlight().toLowerCase());
                  return (
                    <box flexDirection="row" flexShrink={0}>
                      <text fg={found() ? theme.warn : theme.faint} flexShrink={0}>
                        {`${String(i() + 1).padStart(4)} `}
                      </text>
                      <text fg={found() ? theme.brandBright : lineColor(line)}>{clip(line, inner() - 5)}</text>
                    </box>
                  );
                }}
              </For>
              <Show when={cut()}>
                <text fg={theme.faint}>{'… (the rest is cut: open it with your editor)'}</text>
              </Show>
            </scrollbox>
          </box>
        </Show>
      </Show>
    </box>
  );
}
