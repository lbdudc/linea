import { seededWorkspace } from './helpers.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findEditor, excludeFromGit, setLauncher, which, type Editor } from '../src/core/editor.js';
import { createLocalModularLine, createLocalPackage, setLocalLineModules } from '../src/core/workspace.js';
import { runShell } from '../src/shell.js';

let tmp: string;
let bin: string;
const saved: Record<string, string | undefined> = {};
const cwd0 = process.cwd();
const KEYS = ['LINEA_HOME', 'PATH', 'Path', 'VISUAL', 'EDITOR', 'LINEA_TOKEN'];
beforeAll(() => {
  for (const k of KEYS) saved[k] = process.env[k];
});
afterAll(() => {
  for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});

/** A command on PATH that is just a file: enough for `which`; it is never run (the launcher is replaced). */
const fakeCommand = (name: string): string => {
  const file = path.join(bin, process.platform === 'win32' ? `${name}.cmd` : name);
  fs.writeFileSync(file, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', { mode: 0o755 });
  return file;
};

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linea-open-')));
  bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  process.env['LINEA_HOME'] = path.join(tmp, 'home');
  fs.mkdirSync(process.env['LINEA_HOME'], { recursive: true });
  process.env['PATH'] = bin; // (on Windows this is the same variable as `Path`)
  delete process.env['VISUAL'];
  delete process.env['EDITOR'];
});
afterEach(() => {
  process.chdir(cwd0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sh = async (...argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runShell(
    argv,
    { write: (s: string) => out.push(s) } as unknown as NodeJS.WriteStream,
    { write: (s: string) => err.push(s), isTTY: false } as unknown as NodeJS.WriteStream,
  );
  return { code, out: out.join(''), err: err.join('') };
};

describe('findEditor', () => {
  it('prefers what was asked, then $VISUAL, $EDITOR, then VS Code and its family', () => {
    expect(findEditor()).toBeUndefined();
    fakeCommand('codium');
    expect(findEditor()?.name).toBe('codium');
    fakeCommand('code');
    expect(findEditor()?.name).toBe('code');
    expect(findEditor()).toMatchObject({ windowed: true, workspaces: true });

    fakeCommand('vim');
    process.env['EDITOR'] = 'vim -u NONE';
    expect(findEditor()).toMatchObject({ name: 'vim', windowed: false, workspaces: false });
    fakeCommand('nano');
    process.env['VISUAL'] = 'nano';
    expect(findEditor()?.name).toBe('nano');
    expect(findEditor({ preferred: 'code' })?.name).toBe('code');
  });

  it('says when the editor asked for is not there', () => {
    expect(() => findEditor({ preferred: 'nope-editor' })).toThrow(/not on your PATH/);
  });

  it('which finds commands the way the shell does', () => {
    const file = fakeCommand('thing');
    expect(which('thing', { PATH: bin })).toBe(file);
    expect(which('absent', { PATH: bin })).toBeUndefined();
  });

  it('on Windows finds code.cmd, not the extensionless script VS Code leaves next to it (Windows cannot run that one)', () => {
    fs.writeFileSync(path.join(bin, 'code'), '#!/bin/sh\n');
    const shim = path.join(bin, 'code.cmd');
    fs.writeFileSync(shim, '@echo off\r\n');
    expect(which('code', { PATH: bin, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, 'win32')).toBe(shim);
  });
});

describe('linea open', () => {
  let started: { editor: Editor; targets: string[] }[];
  let restore: () => void;
  beforeEach(() => {
    started = [];
    restore = setLauncher((editor, targets) => {
      started.push({ editor, targets });
      return { waited: false };
    });
  });
  afterEach(() => restore());

  /** An SPL with a module of the workspace, and a product with a model. */
  const workspace = async () => {
    const ws = seededWorkspace(path.join(tmp, 'ws'));
    createLocalPackage({ workdir: ws, kind: 'metamodel', name: 'shapes' });
    const mod = createLocalPackage({ workdir: ws, kind: 'module', name: 'draw' });
    const manifestPath = path.join(mod.dir, '.linea', 'module.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.requires.metamodels = { 'file:metamodels/shapes': '^0.1.0' };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const line = createLocalModularLine({ workdir: ws, name: 'gis' });
    await setLocalLineModules(ws, line.dir, { 'file:modules/draw': '^0.1.0' });
    process.chdir(line.dir);
    const made = await sh('product', 'new', 'shop');
    expect(made.err.replace(/^[●◐○] .*\n/, '')).toBe('');
    return { ws, line };
  };

  it('opens an SPL as a workspace with the modules it uses next to it', async () => {
    const { ws, line } = await workspace();
    fakeCommand('code');
    const r = await sh('open');
    expect(r.err.replace(/^[●◐○] .*\n/, '')).toBe('');
    expect(r.out).toMatch(/Opened SPL gis in code/);

    const file = path.join(line.dir, '.linea', 'gis.code-workspace');
    expect(started).toHaveLength(1);
    expect(started[0]!.targets).toEqual([file]);
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    const names = content.folders.map((f: { name: string }) => f.name);
    expect(names[0]).toBe('gis (SPL)');
    expect(names).toEqual(expect.arrayContaining(['draw (module)', 'shapes (metamodel)']));
    // paths are relative to the file, so the checkout can move
    expect(path.resolve(path.dirname(file), content.folders[names.indexOf('draw (module)')].path)).toBe(path.join(ws, 'modules', 'draw'));
  });

  it('opens a product from inside it, and a model of it by name', async () => {
    const { line } = await workspace();
    fakeCommand('code');
    process.chdir(path.join(line.dir, 'shop'));
    expect((await sh('open')).out).toMatch(/Opened product shop/);
    expect(started[0]!.targets).toEqual([path.join(line.dir, 'shop')]);

    process.chdir(line.dir);
    const model = await sh('open', 'shop:shapes');
    expect(model.code).toBe(0);
    expect(path.basename(started[1]!.targets[0]!)).toMatch(/^shapes\./);
    expect(started[1]!.targets[0]).toContain(path.join('shop', '.linea', 'models'));

    expect((await sh('open', 'fm')).code).toBe(0);
    expect(started[2]!.targets[0]).toBe(path.join(line.dir, 'models', 'featuremodel.featuremodel'));
  });

  it('opens a module of the workspace, and says what it cannot find', async () => {
    const { ws } = await workspace();
    fakeCommand('code');
    expect((await sh('open', 'draw')).out).toMatch(/Opened module draw/);
    expect(started[0]!.targets).toEqual([path.join(ws, 'modules', 'draw')]);

    const missing = await sh('open', 'nothing-here');
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/Nothing called "nothing-here"/);

    const remote = await sh('open', 'github:acme/auth');
    expect(remote.err).toMatch(/get github:acme\/auth/);
  });

  it('show says what the folded-in commands said: the modules of an SPL, the models of a product', async () => {
    await workspace();
    const spl = await sh('spl', 'show');
    expect(spl.out).toMatch(/SPL: gis \(made of modules\)/);
    expect(spl.out).toMatch(/Direct modules:\s+draw/);
    expect(spl.out).toMatch(/Resolved \(dependencies first\):/);
    expect((await sh('spl', 'modules')).out).toMatch(/Direct modules:/); // the old name still works

    const product = await sh('product', 'show', 'shop');
    expect(product.out).toMatch(/Product: shop/);
    expect(product.out).toMatch(/Models:[\s\S]*\n\s+shapes\s/);
    expect((await sh('product', 'models', 'shop')).out).toMatch(/Models:/);
  });

  it('--print shows the command without starting anything; --editor and config editor choose', async () => {
    await workspace();
    fakeCommand('code');
    fakeCommand('cursor');
    const printed = await sh('open', '--print');
    expect(printed.out).toMatch(/^code .*gis\.code-workspace/);
    expect(started).toHaveLength(0);

    expect((await sh('open', '--editor', 'cursor', '--print')).out).toMatch(/^cursor /);
    expect((await sh('config', 'editor', 'cursor')).out).toMatch(/Editor set to cursor/);
    expect((await sh('open', '--print')).out).toMatch(/^cursor /);
    expect((await sh('config', 'editor', '--unset')).out).toMatch(/automatic/);
    expect((await sh('open', '--print')).out).toMatch(/^code /);
  });

  it('a terminal editor opens the folder itself and does not get a workspace file', async () => {
    const { line } = await workspace();
    fakeCommand('vim');
    process.env['EDITOR'] = 'vim';
    const r = await sh('open');
    expect(r.code).toBe(0);
    expect(started[0]!.targets).toEqual([line.dir]);
  });

  it('without any editor it says how to get one', async () => {
    await workspace();
    const r = await sh('open');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/No editor found/);
  });
});

describe('excludeFromGit', () => {
  it('adds a pattern once to .git/info/exclude and ignores folders that are not repositories', () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, '.git', 'info'), { recursive: true });
    excludeFromGit(repo, '.linea/*.code-workspace');
    excludeFromGit(repo, '.linea/*.code-workspace');
    expect(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8').match(/code-workspace/g)).toHaveLength(1);
    fs.mkdirSync(path.join(tmp, 'plain'));
    expect(() => excludeFromGit(path.join(tmp, 'plain'), 'x')).not.toThrow();
    expect(fs.existsSync(path.join(tmp, 'plain', '.git'))).toBe(false);
  });
});

describe('init and doctor', () => {
  it('init makes a workspace, and says so when it already is one', async () => {
    const dir = path.join(tmp, 'work');
    fs.mkdirSync(dir);
    process.chdir(dir);
    expect((await sh('init')).out).toMatch(/Workspace created/);
    expect(fs.existsSync(path.join(dir, 'modules'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.linea', 'workspace.json'))).toBe(true);
    expect((await sh('init')).out).toMatch(/Already a workspace/);
  });

  it('doctor reports what is there and what is not, without the network unless asked', async () => {
    const dir = seededWorkspace(path.join(tmp, 'work'));
    process.chdir(dir);
    fakeCommand('code');
    const r = await sh('doctor', '--json');
    const checks = JSON.parse(r.out) as { label: string; level: string }[];
    expect(checks.find((c) => c.label === 'editor')?.level).toBe('ok');
    expect(checks.find((c) => c.label === 'workspace')?.level).toBe('ok');
    const text = await sh('doctor');
    expect(text.out).toMatch(/editor\s+code/);
    expect(text.out).toMatch(/not checked \(doctor --online/);
  });
});
