import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP = 'linea';

export function defaultDataDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case 'win32':
      return path.join(process.env['LOCALAPPDATA'] || path.join(home, 'AppData', 'Local'), APP);
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', APP);
    default:
      return path.join(process.env['XDG_DATA_HOME'] || path.join(home, '.local', 'share'), APP);
  }
}

export function resolvePath(input: string): string {
  let p = input.trim();
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    p = path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(p);
}

export function ensureDir(input: string): string {
  const abs = resolvePath(input);
  try {
    fs.mkdirSync(abs, { recursive: true });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EEXIST' || err.code === 'ENOTDIR') throw new Error(`Not a folder: ${abs}`);
    throw new Error(`Could not create folder ${abs}: ${err.message}`);
  }
  if (!fs.statSync(abs).isDirectory()) throw new Error(`Not a folder: ${abs}`);
  return abs;
}

export function resolveWorkdir(stored?: string): string {
  try {
    return ensureDir(stored ?? defaultDataDir());
  } catch {
    return process.cwd();
  }
}

export function displayPath(p: string): string {
  const home = os.homedir();
  if (p === home) return '~';
  if (p.startsWith(home + path.sep)) return '~' + p.slice(home.length);
  return p;
}
