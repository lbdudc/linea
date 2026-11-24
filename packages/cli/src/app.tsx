import { modeOf, online } from './core/mode.js';
import fs from 'node:fs';
import path from 'node:path';
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/solid';
import type { KeyEvent } from '@opentui/core';
import { onTokenRefreshed, startAutoRefresh } from './core/client.js';
import { loadState, saveState, type StoredLayout } from './core/credentials.js';
import { findContext } from './core/context.js';
import { buildSession } from './core/session.js';
import { tokenize } from './core/args.js';
import { execute, render } from './commands/dispatch.js';
import { resolveCommand } from './commands/registry.js';
import { persistSession } from './shell.js';
import type { CommandContext, DialogView, Session } from './commands/types.js';
import { guideState, guideStateAsync, tipsFor } from './core/guide.js';
import { sidebarOf, type SidebarEntry } from './core/sidebar.js';
import { repoPathOf, type CodeTarget } from './core/codeview.js';
import { forgetRemoteSplNames, refreshRemoteCatalog, remoteCatalog, remoteSplSummaries } from './core/remote.js';
import { KEYS_HELP } from './ui/keys.js';
import { HistoryView, type HistoryItem } from './ui/Output.js';
import { Prompt } from './ui/Prompt.js';
import { Dialog } from './ui/Dialog.js';
import { Divider, Sidebar, type SidebarAction, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_COLUMNS, SIDEBAR_MIN_WIDTH } from './ui/Sidebar.js';
import { CodePanel, CODE_DEFAULT_WIDTH, CODE_MAX_WIDTH, CODE_MIN_WIDTH } from './ui/CodePanel.js';
import { StatusBar } from './ui/StatusBar.js';
import { theme } from './ui/theme.js';
import { Welcome } from './ui/Welcome.js';

let nextId = 1;

const SPINNER = ['✻', '✽', '✶', '✳', '✢', '·', '✢', '✳', '✶', '✽'];

/** What is happening, with how long it has been: `✻ deriving product… 12s`. */
function Busy(props: { status: string | null; doing: string; cancellable?: boolean }) {
  const [frame, setFrame] = createSignal(0);
  const [seconds, setSeconds] = createSignal(0);
  const started = Date.now();
  const t = setInterval(() => {
    setFrame((n) => (n + 1) % SPINNER.length);
    setSeconds(Math.floor((Date.now() - started) / 1000));
  }, 120);
  onCleanup(() => clearInterval(t));
  return (
    <box flexDirection="row" flexShrink={0} paddingLeft={1}>
      <text fg={theme.brand}>{SPINNER[frame()]}</text>
      <text fg={theme.brandBright}>{` ${(props.status ?? props.doing).replace(/(…|\.\.\.)+$/, '')}…`}</text>
      <text fg={theme.faint}>{seconds() >= 2 ? ` ${seconds()}s` : ''}</text>
      <Show when={props.cancellable}>
        <text fg={theme.faint}>{'  · esc to give up'}</text>
      </Show>
    </box>
  );
}

export function App(props: { version: string }) {
  const renderer = useRenderer();
  const [history, setHistory] = createSignal<HistoryItem[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<string | null>(null);
  const [cmdHistory, setCmdHistory] = createSignal<string[]>([]);

  const [session, setSession] = createSignal<Session>(
    (() => {
      const { session: initial } = buildSession();
      return { ...initial, interactive: true };
    })(),
  );

  // where you are and what is worth doing there: refreshed after each command, since a command changes it
  const [guide, setGuide] = createSignal(guideState(session()));
  const tips = createMemo(() => tipsFor(guide()));
  // the folder walk is quick and shows at once; git's status comes when git answers, so a command's end never waits for it
  let guideRun = 0;
  const refreshGuide = () => {
    const run = ++guideRun;
    const now = session();
    const previous = guide();
    setGuide(guideState(now, undefined, { ...(previous.line ? { line: previous.line } : {}), ...(previous.product ? { product: previous.product } : {}) }));
    void guideStateAsync(now).then((state) => {
      if (run === guideRun) setGuide(state);
    });
  };
  const [doing, setDoing] = createSignal('working');

  // the left panel: shown when the window is wide enough; it follows the folder, and what a command did to it
  const size = useTerminalDimensions();
  // what LINEA and the git host have, once signed in: asked for in the background (a login makes it ask again), shown as `↓`
  const [remoteTick, setRemoteTick] = createSignal(0);
  const loadRemote = (force = false) => {
    if (!online(session())) {
      forgetRemoteSplNames();
      return setRemoteTick((t) => t + 1);
    }
    void refreshRemoteCatalog({ force }).then(() => setRemoteTick((t) => t + 1));
  };
  const sidebar = createMemo(() => {
    guide();
    remoteTick();
    const found = remoteCatalog();
    return sidebarOf(session(), findContext(session().cwd ?? process.cwd()), {
      lines: remoteSplSummaries().map((l) => ({ name: l.name, ...(l.webUrl ? { ref: l.webUrl } : {}) })),
      modules: found.modules.map((m) => ({ name: m.name, ref: m.location })),
      metamodels: found.metamodels.map((m) => ({ name: m.name, ref: m.location })),
    });
  });

  // the panels at the sides: the list at the left, the code of what you picked at the right; both can be hidden and resized
  // as they were left the last time (`~/.linea/credentials.json` keeps them with the other settings of the window)
  const saved = loadState().layout ?? {};
  const [sidebarOpen, setSidebarOpen] = createSignal(saved.sidebar ?? true);
  const [sidebarWidth, setSidebarWidth] = createSignal(saved.sidebarWidth ?? SIDEBAR_DEFAULT_WIDTH);
  const [codeOpen, setCodeOpen] = createSignal(saved.code ?? false);
  const [codeWidth, setCodeWidth] = createSignal(saved.codeWidth ?? CODE_DEFAULT_WIDTH);
  const [folded, setFolded] = createSignal<ReadonlySet<string>>(new Set(saved.folded ?? []));
  const toggleFold = (group: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (!next.delete(group)) next.add(group);
      return next;
    });
  // the keys are for the list (Ctrl+E), not for the prompt
  const [listFocus, setListFocus] = createSignal(false);
  const remember = (layout: StoredLayout) => {
    try {
      saveState({ layout: { ...loadState().layout, ...layout } });
    } catch {
      /* a settings file that cannot be written must not bother the window */
    }
  };
  // what is shown or hidden is saved as it changes (not at the start: nothing changed yet)...
  createEffect(on([sidebarOpen, codeOpen, folded], () => remember({ sidebar: sidebarOpen(), code: codeOpen(), folded: [...folded()] }), { defer: true }));
  // ...and how wide a moment after the last step of a drag
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      [sidebarWidth, codeWidth],
      () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => remember({ sidebarWidth: sidebarWidth(), codeWidth: codeWidth() }), 400);
      },
      { defer: true },
    ),
  );
  onCleanup(() => saveTimer && clearTimeout(saveTimer));
  const [picked, setPicked] = createSignal<SidebarEntry | undefined>();
  // the search of the code panel has the keys while it is on; a button can leave a start of a command in the prompt
  const [searching, setSearching] = createSignal(false);
  const [prefill, setPrefill] = createSignal<{ text: string; id: number } | undefined>();
  let prefillId = 0;
  const fill = (text: string) => setPrefill({ text, id: ++prefillId });
  // a result shown over the conversation, as a terminal window (`fm analyze`)
  const [dialog, setDialog] = createSignal<DialogView | null>(null);
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  // the conversation keeps at least this much of the window
  const MAIN_MIN = 44;
  const showSidebar = () => sidebarOpen() && size().width >= SIDEBAR_MIN_COLUMNS;
  const showCode = () => codeOpen() && size().width >= 90;
  const leftWidth = () => clamp(sidebarWidth(), SIDEBAR_MIN_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, size().width - MAIN_MIN - 4 - (showCode() ? CODE_MIN_WIDTH : 0))));
  const rightWidth = () => clamp(codeWidth(), CODE_MIN_WIDTH, Math.max(CODE_MIN_WIDTH, Math.min(CODE_MAX_WIDTH, size().width - MAIN_MIN - 4 - (showSidebar() ? leftWidth() : 0))));

  /** What the right panel shows: what was picked, or else where you are. */
  const codeTarget = createMemo((): CodeTarget | undefined => {
    const entry = picked();
    if (entry) {
      if (entry.dir && entry.where !== 'remote') return { kind: 'local', title: entry.name, dir: entry.dir };
      if (entry.remote) return { kind: 'remote', title: entry.name, repo: repoPathOf(entry.remote), ref: 'main' };
      return undefined;
    }
    const g = guide();
    const here = g.product ?? g.line ?? g.pkg;
    return here ? { kind: 'local', title: here.name, dir: g.folder } : undefined;
  });
  /** the buttons of the code panel next to the thing shown: its page, and its folder when it is here */
  const codeTools = createMemo((): { label: string; command: string }[] => {
    const entry = picked();
    const tools: { label: string; command: string }[] = [];
    if (entry?.where === 'remote') {
      if (entry.remote) tools.push({ label: 'browser', command: `browse ${entry.remote}` });
    } else {
      tools.push({ label: 'browser', command: entry ? `browse ${entry.name}` : 'browse' });
      tools.push({ label: 'folder', command: entry ? `reveal ${entry.name}` : 'reveal' });
    }
    return tools;
  });
  const codeAction = createMemo(() => {
    const entry = picked();
    if (!entry || entry.where !== 'remote') return undefined;
    if (entry.kind === 'SPL') return { label: 'get', command: `get ${entry.name}` };
    if (entry.remote && (entry.kind === 'module' || entry.kind === 'metamodel')) return { label: 'clone', command: `${entry.kind} clone ${entry.remote}` };
    return undefined;
  });
  const changes = createMemo(() => {
    const g = guide();
    return {
      ...(g.line && g.line.changes ? { [g.line.name]: g.line.changes } : {}),
      ...(g.line && g.product && g.product.changes ? { [`${g.line.name}/${g.product.name}`]: g.product.changes } : {}),
    } as Record<string, number>;
  });

  const push = (item: Omit<HistoryItem, 'id'>) =>
    setHistory((h) => [...h, { id: nextId++, ...item }]);

  onMount(() => {
    onTokenRefreshed((token) => saveState({ token }));
    startAutoRefresh();
  });

  // the list follows the folders: an SPL, module or product that appears (or goes) from outside shows up without a command
  createEffect(() => {
    const now = session();
    const folder = findContext(now.cwd ?? process.cwd());
    const root = folder.workspace ?? now.workdir;
    if (!root) return;
    const dirs = [root, path.join(root, 'modules'), path.join(root, 'metamodels'), ...(folder.line?.dir ? [folder.line.dir] : [])];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = (name: string | null) => {
      // what git and the editors write inside their own folders is not a change of the list
      if (name && /^(\.git|\.linea|node_modules)(\\|\/|$)/.test(name)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => refreshGuide(), 500);
    };
    const watchers = dirs.flatMap((d) => {
      try {
        if (!fs.existsSync(d)) return [];
        const w = fs.watch(d, { persistent: false }, (_event, name) => changed(name ? String(name) : null));
        w.on('error', () => w.close());
        return [w];
      } catch {
        return [];
      }
    });
    const stop = (): void => {
      if (timer) clearTimeout(timer);
      for (const w of watchers) w.close();
    };
    // the window going away ends them too (a watched folder cannot be removed on Windows while it is watched)
    renderer.once('destroy', stop);
    onCleanup(() => {
      renderer.off('destroy', stop);
      stop();
    });
  });

  const ctx = (): Omit<CommandContext, 'args' | 'rest'> => ({
    session: session(),
    updateSession: (patch) => {
      setSession((prev) => ({ ...prev, ...patch }));
      persistSession(patch);
    },
    setStatus,
    print: (text, kind = 'output') => push({ kind, text }),
    dialog: (view) => setDialog(view),
    clear: () => setHistory([]),
    exit: () => {
      renderer.destroy();
      process.exit(0);
    },
  });

  useKeyboard((e: KeyEvent) => {
    if (e.ctrl && e.name === 'l') return setHistory([]);
    if (e.ctrl && e.name === 'b') return setSidebarOpen((v) => !v);
    if (e.ctrl && e.name === 'e') {
      setSidebarOpen(true);
      return setListFocus((v) => !v);
    }
    // Esc while a command that can be given up is running
    if (e.name === 'escape' && busy() && cancelling) return cancelling();
    if (e.ctrl && e.name === 'o') return setCodeOpen((v) => !v);
    if (e.ctrl && e.name === 'f') {
      setCodeOpen(true);
      return setSearching(true);
    }
    if (dialog() && (e.name === 'escape' || e.name === 'return')) return setDialog(null);
    if (e.ctrl && e.name === 'k') return push({ kind: 'info', text: KEYS_HELP });
    if (e.ctrl && e.name === 'c') {
      renderer.destroy();
      process.exit(0);
    }
  });

  // gives up the command that is running, when it can be
  let cancelling: (() => void) | undefined;
  const [cancellable, setCancellable] = createSignal(false);

  const run = (command: string) => {
    if (!busy()) void runInput(command);
  };
  /** The buttons at the bottom of the list: what is worth one click from where you are. */
  const actions = createMemo((): SidebarAction[] => {
    const g = guide();
    const list: SidebarAction[] = [];
    list.push(online(session()) ? { label: 'refresh from LINEA', onClick: () => loadRemote(true) } : { label: modeOf(session()) === 'offline' ? 'connect to LINEA' : 'sign in', onClick: () => run(modeOf(session()) === 'offline' ? 'mode server' : 'login') });
    list.push({ label: 'new SPL…', onClick: () => fill('spl new ') });
    list.push({ label: 'open in browser', onClick: () => run(`browse${picked() ? ` ${picked()!.remote ?? picked()!.name}` : ''}`) });
    list.push({ label: 'show in folder', onClick: () => run(`reveal${picked()?.dir ? ` ${picked()!.name}` : ''}`) });
    list.push({ label: 'search files', keys: '^F', onClick: () => (setCodeOpen(true), setSearching(true)) });
    list.push({ label: 'code panel', keys: '^O', onClick: () => setCodeOpen((v) => !v) });
    list.push({ label: 'use the keys here', keys: '^E', onClick: () => setListFocus(true) });
    list.push({ label: 'hide this list', keys: '^B', onClick: () => setSidebarOpen(false) });
    list.push({ label: 'help', onClick: () => run('help') });
    return list;
  });

  /** A click on the list: what is here, you go to; what is only on LINEA, its code is shown (and `get` is one click away). */
  function select(entry: SidebarEntry) {
    setPicked(entry);
    if (entry.where === 'remote') setCodeOpen(true);
    else if (!busy()) void runInput(`cd ${entry.name}`);
  }

  async function runInput(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;

    push({ kind: 'input', text: trimmed });
    setCmdHistory((h) => (h[h.length - 1] === trimmed ? h : [...h, trimmed]));

    // `/spl list`, `spl list` and `linea spl list` are the same thing
    const tokens = trimmed === '?' ? ['keys'] : tokenize(trimmed.startsWith('/') ? trimmed.slice(1) : trimmed);

    setDoing(tokens.slice(0, 2).join(' ') || 'working');
    const wasOnline = online(session());
    setBusy(true);
    const controller = new AbortController();
    const resolved = resolveCommand(tokens.filter((t) => t !== '--json' && t !== '--local' && t !== '--offline'));
    const canGiveUp = !('error' in resolved) && Boolean(resolved.cmd.cancellable);
    cancelling = canGiveUp ? () => controller.abort() : undefined;
    setCancellable(canGiveUp);
    try {
      const folder = findContext(session().cwd ?? process.cwd());
      const outcome = await execute({ tokens, session: session(), folder, hooks: ctx(), signal: controller.signal });
      const text = render(outcome);
      if (text) push({ kind: outcome.error ? 'error' : 'output', text });
    } finally {
      cancelling = undefined;
      setCancellable(false);
      setBusy(false);
      setStatus(null);
      refreshGuide();
      // a login (or logout) changes who is asking; otherwise this only renews what is older than a few seconds
      loadRemote(online(session()) !== wasOnline || ['login', 'logout', 'mode', 'server', 'remote', 'profile'].includes(tokens[0] ?? ''));
    }
  }

  return (
    <box flexDirection="row" flexGrow={1} padding={1}>
      <Show when={!sidebarOpen() && size().width >= SIDEBAR_MIN_COLUMNS}>
        <box flexShrink={0} width={2} onMouseDown={() => setSidebarOpen(true)}>
          <text fg={theme.faint}>{'»'}</text>
        </box>
      </Show>
      <Show when={showSidebar()}>
        <Sidebar
          model={sidebar()}
          changes={changes()}
          width={leftWidth()}
          onSelect={select}
          actions={actions()}
          folded={folded()}
          onToggleFold={toggleFold}
          focused={listFocus() && !dialog() && !searching()}
          onBlur={() => setListFocus(false)}
        />
        <Divider onDrag={(x) => setSidebarWidth(clamp(x - 1, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH))} />
      </Show>
      <box flexDirection="column" flexGrow={1} flexShrink={1}>
        <HistoryView
          items={history()}
          header={<Welcome version={props.version} session={session()} state={guide()} tips={tips()} />}
        />
        <Show
          when={busy()}
          fallback={
            <Prompt
              onSubmit={runInput}
              history={cmdHistory()}
              tips={tips()}
              cwd={session().cwd ?? process.cwd()}
              workdir={session().workdir ?? ''}
              signedIn={session().authed}
              focused={!searching() && !dialog() && !listFocus()}
              {...(prefill() ? { prefill: prefill()! } : {})}
            />
          }
        >
          <Busy status={status()} doing={doing()} cancellable={cancellable()} />
        </Show>
        <StatusBar session={session()} state={guide()} />
      </box>
      <Show when={dialog()}>
        <Dialog view={dialog()!} onClose={() => setDialog(null)} />
      </Show>
      <Show when={showCode()}>
        <Divider onDrag={(x) => setCodeWidth(clamp(size().width - 1 - x, CODE_MIN_WIDTH, CODE_MAX_WIDTH))} />
        <CodePanel
          target={codeTarget()}
          width={rightWidth()}
          {...(codeAction() ? { action: codeAction()! } : {})}
          onAction={(command) => {
            if (!busy()) void runInput(command);
          }}
          tools={codeTools()}
          onClose={() => {
            setCodeOpen(false);
            setSearching(false);
          }}
          searching={searching()}
          onSearching={setSearching}
          onEdit={(file) => {
            if (!busy()) void runInput(`open "${file}"`);
          }}
        />
      </Show>
    </box>
  );
}
