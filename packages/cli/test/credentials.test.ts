import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadState, saveState, clearAuth } from '../src/core/credentials.js';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-test-'));
  process.env.LINEA_HOME = home;
});

afterEach(() => {
  delete process.env.LINEA_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('credential store', () => {
  it('returns {} when nothing is stored', () => {
    expect(loadState()).toEqual({});
  });

  it('round-trips and merges patches', () => {
    saveState({ baseUrl: 'http://x', token: 't1' });
    saveState({ user: { userId: '1', username: 'alice' } });
    const s = loadState();
    expect(s.baseUrl).toBe('http://x');
    expect(s.token).toBe('t1');
    expect(s.user?.username).toBe('alice');
  });

  it('clearAuth drops token+user but keeps context', () => {
    saveState({ baseUrl: 'http://x', token: 't1', workdir: '/w', editor: 'code', user: { userId: '1', username: 'a' } });
    clearAuth();
    const s = loadState();
    expect(s.token).toBeUndefined();
    expect(s.user).toBeUndefined();
    expect(s.baseUrl).toBe('http://x');
    expect(s.workdir).toBe('/w');
    expect(s.editor).toBe('code');
  });

  it('keeps the layout of the window (panels open, widths, folded groups) over a sign-out', () => {
    saveState({ token: 't1', layout: { sidebar: false, sidebarWidth: 40, code: true, codeWidth: 70, folded: ['Modules'] } });
    clearAuth();
    expect(loadState().layout).toEqual({ sidebar: false, sidebarWidth: 40, code: true, codeWidth: 70, folded: ['Modules'] });
  });
});
