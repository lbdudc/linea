export interface Session {
  baseUrl: string;
  authed: boolean;
  /** `server` or `offline` (see `mode`); not set in a session made by hand, which is server when signed in and offline when not */
  mode?: 'server' | 'offline';
  /** `--offline` said on this command: the mode is offline for it alone */
  modeOverride?: boolean;
  /** the sign-in is there but the server no longer takes it */
  expired?: boolean;
  user?: { userId: string; username: string; hosts?: string[]; activeHost?: string | null };
  /** where SPLs, modules and metamodels live side by side */
  workdir?: string;
  /** the folder commands act in: the one the shell was started in, or the one the window was opened in (and `cd` moved to) */
  cwd?: string;
  /** the editor setting (see `config editor`) */
  editor?: string;
  /** the colours of the window (see `config theme`) */
  theme?: string;
  /** true in the interactive window, where a terminal editor cannot be started */
  interactive?: boolean;
  /** set by `--json`: commands that can, put their result in `data` */
  json?: boolean;
}

/** One line of a result shown in a dialog: `label  value`, or the names of a list, or a ratio drawn as a bar. */
export interface DialogRow {
  label: string;
  value?: string;
  tone?: DialogTone;
  /** a heading of what follows, not a value */
  heading?: boolean;
  /** names to list under the label (features) */
  items?: string[];
  /** 0..1, drawn as a bar next to the value */
  ratio?: number;
}

export type DialogTone = 'ok' | 'warn' | 'err' | 'info' | 'plain' | 'dim' | 'brand';

/** A piece of a line of text, in a tone. */
export interface DialogSpan {
  text: string;
  tone?: DialogTone;
  bold?: boolean;
}

/** One thing a command did, as it goes: running, then done (with its detail) or failed. */
export interface DialogStep {
  text: string;
  state: 'running' | 'done' | 'fail';
  detail?: string;
}

/** What the window shows in a panel over the conversation, as a terminal would: the command that ran and what it found. */
export interface DialogView {
  title: string;
  command: string;
  /** while it is still working: what it is doing */
  running?: string;
  /** what was done to get here */
  steps?: DialogStep[];
  rows: DialogRow[];
  /** text to read and scroll (a feature model), line by line */
  lines?: DialogSpan[][];
  /** the last line, like the status a shell leaves: `exit 0 · 1.4s` */
  footer?: { text: string; tone: DialogTone };
  note?: string;
}

export type CommandOutput = string;

export interface CommandContext {
  args: string[];
  rest: string;
  session: Session;
  updateSession: (patch: Partial<Session>) => void;
  setStatus: (msg: string | null) => void;
  print: (text: string, kind?: 'output' | 'info' | 'error') => void;
  /** the window only: show (or, with null, close) a panel over the conversation; one-shot commands have none and only print */
  dialog?: (view: DialogView | null) => void;
  /** what a command can say to a program (`--json`) besides what it says to a person */
  data?: (value: unknown) => void;
  /** says when the person gave up waiting (Esc in the window): a command marked `cancellable` stops what it started */
  signal?: AbortSignal;
  clear: () => void;
  exit: () => void;
}

export interface Command {
  name: string;
  aliases?: string[];
  summary: string;
  usage?: string;
  /** it only works signed in (it talks to the server and nothing else): same as `where: 'server'` */
  requiresAuth?: boolean;
  /**
   * Where it works: `server` (needs the LINEA server and a sign-in), `both` (it does one thing on the server and another on this
   * machine, by the mode), `machine` (this machine only, or git: the default).
   */
  where?: 'server' | 'both' | 'machine';
  /** it can be given up while it runs (Esc in the window) */
  cancellable?: boolean;
  /** it still works, but is not listed: what it did is part of another command now (`spl modules` is in `spl show`) */
  hidden?: boolean;
  /** what its argument is, for completion: a product of the SPL you are in, an SPL (of LINEA or here), a place `cd` goes to, a file */
  arg?: 'product' | 'spl' | 'place' | 'file';
  /** what the flags are, for /help (the parsing is the command's own) */
  flags?: string[];
  run: (ctx: CommandContext) => Promise<CommandOutput> | CommandOutput;
}
