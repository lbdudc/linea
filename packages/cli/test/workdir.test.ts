import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePath, ensureDir, defaultDataDir, displayPath } from '../src/core/workdir.js';

describe('resolvePath', () => {
  it('expands a leading ~ to the home directory', () => {
    expect(resolvePath('~')).toBe(os.homedir());
    expect(resolvePath('~/sub')).toBe(path.join(os.homedir(), 'sub'));
  });

  it('resolves a relative path to an absolute one', () => {
    expect(resolvePath('.')).toBe(process.cwd());
    expect(path.isAbsolute(resolvePath('some/dir'))).toBe(true);
  });
});

describe('defaultDataDir', () => {
  it('returns an OS-native absolute path ending in the app name', () => {
    const dir = defaultDataDir();
    expect(path.isAbsolute(dir)).toBe(true);
    expect(path.basename(dir)).toBe('linea');
  });

  it('follows the platform convention', () => {
    const dir = defaultDataDir();
    if (process.platform === 'win32') {
      expect(dir.toLowerCase()).toContain('appdata');
    } else if (process.platform === 'darwin') {
      expect(dir).toContain(path.join('Library', 'Application Support'));
    } else {
      // XDG_DATA_HOME or ~/.local/share
      expect(dir).toContain(process.env['XDG_DATA_HOME'] ?? path.join('.local', 'share'));
    }
  });
});

describe('displayPath', () => {
  it('collapses the home directory to ~', () => {
    expect(displayPath(os.homedir())).toBe('~');
    expect(displayPath(path.join(os.homedir(), 'a', 'b'))).toBe(`~${path.sep}a${path.sep}b`);
  });

  it('leaves paths outside home untouched', () => {
    const outside = path.resolve(path.sep, 'not', 'home');
    expect(displayPath(outside)).toBe(outside);
  });
});

describe('ensureDir', () => {
  it('creates a missing folder and returns its absolute path', () => {
    const target = path.join(os.tmpdir(), `linea-ed-${Date.now()}`, 'nested');
    const abs = ensureDir(target);
    expect(path.isAbsolute(abs)).toBe(true);
    expect(fs.statSync(abs).isDirectory()).toBe(true);
  });

  it('is idempotent for an existing folder', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-ed-'));
    expect(ensureDir(tmp)).toBe(ensureDir(tmp));
  });

  it('throws when a file sits at the target path', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'linea-ed-')), 'file.txt');
    fs.writeFileSync(f, 'x');
    expect(() => ensureDir(f)).toThrow(/Not a folder/);
  });
});
