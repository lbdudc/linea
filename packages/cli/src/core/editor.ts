import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Editors that open their own window: started and left alone. Anything else is a terminal editor and has to be waited for. */
const WINDOWED = new Set(['code', 'code-insiders', 'cursor', 'codium', 'vscodium', 'windsurf', 'subl', 'zed', 'idea', 'webstorm', 'pycharm', 'goland', 'clion', 'rider', 'phpstorm', 'rubymine', 'fleet', 'atom']);
/** What is tried when nothing says which editor: the ones that understand a .code-workspace file first. */
const DEFAULTS = ['code', 'cursor', 'codium', 'windsurf'];
/** Editors that open a .code-workspace file */
const WORKSPACE_AWARE = new Set(['code', 'code-insiders', 'cursor', 'codium', 'vscodium', 'windsurf']);

type Env = Record<string, string | undefined>;

export interface Editor {
  /** what it is called: `code` */
  name: string;
  /** the file to run */
  command: string;
  windowed: boolean;
  /** it opens a `.code-workspace` file (VS Code and its family) */
  workspaces: boolean;
}

const baseName = (command: string): string => path.basename(command).replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase();

/** The file a command name is on PATH, as the shell would find it (PATHEXT on Windows: `code.cmd` before the extensionless `code` script VS Code puts next to it, which Windows cannot run). */
export function which(command: string, env: Env = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) return fs.existsSync(command) ? command : undefined;
  const dirs = (env['PATH'] ?? env['Path'] ?? '').split(path.delimiter).filter(Boolean);
  const exts = platform === 'win32' ? [...(env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase()), ''] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, command + ext);
      try {
        if (fs.statSync(file).isFile()) return file;
      } catch {
        /* not here */
      }
    }
  }
  return undefined;
}

const describe = (command: string): Editor => {
  const name = baseName(command);
  return { name, command, windowed: WINDOWED.has(name), workspaces: WORKSPACE_AWARE.has(name) };
};

/**
 * The editor to use: the one asked for (`--editor`, or the `editor` setting), then `$VISUAL`, `$EDITOR`, then the first of VS Code,
 * Cursor, VSCodium, Windsurf on PATH. `$EDITOR` may carry arguments (`code --wait`): the first word is the editor.
 */
export function findEditor(opts: { preferred?: string; env?: Env; platform?: NodeJS.Platform } = {}): Editor | undefined {
  const env = opts.env ?? process.env;
  const candidates = [opts.preferred, env['VISUAL'], env['EDITOR']].filter((c): c is string => Boolean(c?.trim()));
  for (const raw of candidates) {
    const word = raw.trim().split(/\s+/)[0]!;
    const found = which(word, env, opts.platform);
    if (found) return describe(found);
    if (raw === opts.preferred) throw new Error(`The editor "${word}" is not on your PATH.`);
  }
  for (const name of DEFAULTS) {
    const found = which(name, env, opts.platform);
    if (found) return describe(found);
  }
  return undefined;
}

/** Runs the editor on some paths. Behind an object so tests can see what would start without starting it. */
export const launcher = {
  start(editor: Editor, targets: string[]): { waited: boolean } {
    const isShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(editor.command);
    const quote = (s: string) => (isShim ? `"${s}"` : s);
    const options = { shell: isShim, windowsHide: true };
    if (editor.windowed) {
      const child = spawn(quote(editor.command), targets.map(quote), { ...options, detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
      return { waited: false };
    }
    spawnSync(quote(editor.command), targets.map(quote), { ...options, stdio: 'inherit' });
    return { waited: true };
  },
};

/** For tests: replace what starts the editor. */
export function setLauncher(fn: typeof launcher.start): () => void {
  const original = launcher.start;
  launcher.start = fn;
  return () => {
    launcher.start = original;
  };
}

/** The `.code-workspace` of an SPL: itself and the modules and metamodels of the workspace it uses, as folders. */
export function codeWorkspace(opts: { name: string; folders: { name: string; path: string }[] }): string {
  return JSON.stringify(
    {
      folders: opts.folders,
      settings: { 'files.exclude': { '**/.git': true }, 'search.exclude': { '**/node_modules': true, '**/.linea/composed-model.uvl': true } },
      extensions: { recommendations: ['langium.langium-vscode'] },
    },
    null,
    2,
  ) + '\n';
}

export { excludeFromGit } from '@lbdudc/linea-core/workspace';
