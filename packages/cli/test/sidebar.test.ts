import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sidebarOf } from '../src/core/sidebar.js';
import { changedFilesOf, diffOf, grepLocal, matchFiles, repoPathOf, rowsOf } from '../src/core/codeview.js';
import { spawnSync } from 'node:child_process';
import { wrapNames, barOf } from '../src/ui/Dialog.js';
import { viewUvl } from '../src/core/uvlview.js';
import type { Session } from '../src/commands/types.js';

const remote = {
  lines: [{ name: 'alpha', ref: 'https://git.example/g/alpha' }, { name: 'gamma' }],
  modules: [{ name: 'auth', ref: 'gitlab:g/auth' }],
  metamodels: [],
};

test('the side panel says where each thing is, once signed in: here and on LINEA, only here, only on LINEA', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-sidebar-'));
  try {
    fs.mkdirSync(path.join(root, 'alpha', 'src', 'platform'), { recursive: true });
    fs.mkdirSync(path.join(root, 'beta', 'src', 'platform'), { recursive: true });
    const session = (authed: boolean): Session => ({ baseUrl: 'http://x', authed, workdir: root, cwd: root });
    const folder = { workspace: root } as Parameters<typeof sidebarOf>[1];

    const signedOut = sidebarOf(session(false), folder, remote);
    expect(signedOut.signedIn).toBe(false);
    expect(signedOut.lines.map((l) => [l.name, l.where])).toEqual([['alpha', 'here'], ['beta', 'here']]);
    expect(signedOut.modules).toEqual([]);

    const signedIn = sidebarOf(session(true), folder, remote);
    expect(signedIn.lines.map((l) => [l.name, l.where])).toEqual([['alpha', 'both'], ['beta', 'here'], ['gamma', 'remote']]);
    expect(signedIn.lines[0]!.remote).toBe('https://git.example/g/alpha');
    expect(signedIn.modules.map((m) => [m.name, m.where, m.remote])).toEqual([['auth', 'remote', 'gitlab:g/auth']]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the code panel: a repository path from a host address or a location, and a tree with folders first', () => {
  expect(repoPathOf('https://gitlab.example.com/group/sub/proj.git')).toBe('group/sub/proj');
  expect(repoPathOf('gitlab:group/proj')).toBe('group/proj');

  const files = ['README.md', 'src/b.ts', 'src/a.ts', 'src/deep/c.ts', 'spl.json'];
  expect(rowsOf(files, new Set()).map((r) => r.path)).toEqual(['src', 'README.md', 'spl.json']);
  expect(rowsOf(files, new Set(['src'])).map((r) => r.path)).toEqual(['src', 'src/deep', 'src/a.ts', 'src/b.ts', 'README.md', 'spl.json']);
});

test('search: file names in order of the characters, whole matches first; and the text of the files of a folder', async () => {
  const files = ['src/platform/index.ts', 'spl.json', 'docs/split.md', 'README.md'];
  expect(matchFiles(files, 'spl')).toEqual(['spl.json', 'docs/split.md', 'src/platform/index.ts']);
  expect(matchFiles(files, 'rdm')).toEqual(['README.md']);
  expect(matchFiles(files, '  ')).toEqual([]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-grep-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), ['one', 'Two Features', 'three'].join('\n'));
    fs.writeFileSync(path.join(dir, 'b.bin'), Buffer.from([0, 1, 2, 102, 101, 97, 116, 117, 114, 101]));
    const hits = await grepLocal(dir, ['a.txt', 'b.bin'], 'features', () => true);
    expect(hits).toEqual([{ path: 'a.txt', line: 2, text: 'Two Features' }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the analysis dialog: names are laid out in lines, and a ratio is drawn as a bar', () => {
  expect(wrapNames(['aa', 'bb', 'cc', 'dd'], 8)).toEqual(['aa  bb', 'cc  dd']);
  expect(barOf(0.5, 10)).toBe('█████░░░░░');
  expect(barOf(2, 4)).toBe('████');
});

test('fm show: the tabs and the lines of mandatory/optional/or/alternative become a compact tree, constraints after', () => {
  const T = String.fromCharCode(9);
  const NL = String.fromCharCode(10);
  const at = (depth: number, text: string): string => T.repeat(depth) + text;
  const uvl = [
    'features',
    at(1, 'Shop {abstract}'),
    at(2, 'mandatory'),
    at(3, 'Pay'),
    at(4, 'alternative'),
    at(5, 'Card'),
    at(5, 'Cash'),
    at(2, 'optional'),
    at(3, 'Gift'),
    'constraints',
    at(1, 'Gift => Card'),
  ].join(NL);
  const view = viewUvl(uvl);
  expect(view.features).toBe(5);
  expect(view.constraints).toBe(1);
  expect(view.text.split(NL)).toEqual([
    'features',
    '■ Shop {abstract}',
    '├─ ● Pay',
    '│  ├─ ◇ Card',
    '│  └─ ◇ Cash',
    '└─ ○ Gift',
    '',
    'constraints (1)',
    '  Gift => Card',
  ]);
});

test('the code panel marks what changed since the last commit, and shows the diff of a file (a new one is all additions)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-changed-'));
  const git = (...args: string[]) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir });
  try {
    expect((await changedFilesOf(dir)).size).toBe(0);
    git('init');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'a.txt'), 'old\nsame\n');
    fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), 'b\n');
    git('add', '.');
    git('commit', '-m', 'first');
    expect((await changedFilesOf(dir)).size).toBe(0);

    fs.writeFileSync(path.join(dir, 'a.txt'), 'new\nsame\n');
    fs.writeFileSync(path.join(dir, 'sub', 'c.txt'), 'c1\nc2\n');
    const changed = await changedFilesOf(dir);
    expect(Object.fromEntries(changed)).toEqual({ 'a.txt': 'modified', 'sub/c.txt': 'new' });
    // from inside a folder of the repository the paths are relative to that folder
    expect(Object.fromEntries(await changedFilesOf(path.join(dir, 'sub')))).toEqual({ 'c.txt': 'new' });

    const diff = (await diffOf(dir, 'a.txt', 'modified')).split('\n');
    expect(diff[0]).toMatch(/^@@/);
    expect(diff).toContain('-old');
    expect(diff).toContain('+new');
    expect((await diffOf(dir, 'sub/c.txt', 'new')).split('\n')).toContain('+c1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
