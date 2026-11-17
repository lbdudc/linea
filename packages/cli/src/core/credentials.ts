import fs from 'fs';
import { config } from './config.js';
import os from 'os';
import path from 'path';

function dir(): string {
  return path.join(process.env['LINEA_HOME'] ?? os.homedir(), '.linea');
}
function file(): string {
  return path.join(dir(), 'credentials.json');
}

/** The user's own access to the git host, as the LINEA server gave it at login (`/api/users/git-credentials`). */
export interface StoredGit {
  /** the LINEA server it was obtained for: git access that came from another one is not this server's */
  server: string;
  /** `server`: given by LINEA's server at login · `token`: a personal access token the user gave (it is kept over what the server says) */
  source: 'server' | 'token';
  provider: 'gitlab' | 'github' | 'local';
  host: { url?: string; webUrl?: string; apiUrl?: string };
  username: string;
  token: string;
}

export interface StoredState {
  git?: StoredGit;
  baseUrl?: string;
  token?: string;
  user?: { userId: string; username: string };
  workdir?: string;
  /** the editor `open` uses (a command name, `code`); otherwise $VISUAL, $EDITOR or the first VS Code-like one found */
  editor?: string;
  /** the colours of the window (see ui/themes.ts); otherwise the default */
  theme?: string;
  /** the panels of the window as they were left: the list at the left and the code at the right, open or not, and how wide */
  layout?: StoredLayout;
}

export interface StoredLayout {
  sidebar?: boolean;
  sidebarWidth?: number;
  code?: boolean;
  codeWidth?: number;
  /** the groups of the list that are folded (`Modules`, `Metamodels`) */
  folded?: string[];
}

/** The LINEA server commands talk to: the environment's, else the one stored, else the local default. */
export function serverOf(state: StoredState = loadState()): string {
  return config.BASE_URL_FROM_ENV ? config.DEFAULT_BASE_URL : (state.baseUrl ?? config.DEFAULT_BASE_URL);
}

/** The git access that belongs to the server in use: what was obtained for another one (or before servers were recorded) is left out. */
export function storedGit(state: StoredState = loadState()): StoredGit | undefined {
  return state.git && state.git.server === serverOf(state) ? state.git : undefined;
}

export function loadState(): StoredState {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8')) as StoredState;
  } catch {
    return {};
  }
}

function write(state: StoredState): void {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(state, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file(), 0o600);
  } catch {
    /* best-effort (e.g. Windows) */
  }
}

export function saveState(patch: Partial<StoredState>): StoredState {
  const next = { ...loadState(), ...patch };
  write(next);
  return next;
}

export function clearAuth(): void {
  const { baseUrl, workdir, editor, theme, layout } = loadState();
  write({ baseUrl, workdir, editor, theme, layout });
}
