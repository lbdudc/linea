import { seededWorkspace } from './helpers.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFlags, tokenize } from '../src/core/args.js';
import { findContext, initWorkspace } from '../src/core/context.js';
import { runShell } from '../src/shell.js';
import { createLocalModularLine } from '../src/core/workspace.js';

describe('tokenize and parseFlags', () => {
  it('groups quotes and splits on spaces', () => {
    expect(tokenize(`spl new "my spl" --desc 'a b'`)).toEqual(['spl', 'new', 'my spl', '--desc', 'a b']);
    expect(tokenize('  a   b ')).toEqual(['a', 'b']);
    expect(tokenize('x ""')).toEqual(['x', '']);
  });

  it('separates words from flags, with values, shorts and =', () => {
    const { positional, flags } = parseFlags(['shop', '--features', 'A,B', '-m', 'msg', '--yes', '--to=gh'], {
      value: { features: undefined, message: 'm', to: undefined },
      bool: { yes: 'y' },
    });
    expect(positional).toEqual(['shop']);
    expect(flags).toEqual({ features: 'A,B', message: 'msg', yes: true, to: 'gh' });
  });

  it('says when a flag that needs a value has none', () => {
    expect(() => parseFlags(['--features'], { value: { features: undefined } })).toThrow(/needs a value/);
  });
});

let tmp: string;
const saved: Record<string, string | undefined> = {};
const cwd0 = process.cwd();
beforeAll(() => {
  for (const k of ['LINEA_HOME', 'LINEA_BASE_URL', 'LINEA_TOKEN', 'GIT_PROVIDER']) saved[k] = process.env[k];
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linea-grammar-')));
  process.env['LINEA_HOME'] = path.join(tmp, 'home');
  delete process.env['LINEA_TOKEN'];
  fs.mkdirSync(process.env['LINEA_HOME'], { recursive: true });
});
afterEach(() => {
  process.chdir(cwd0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('findContext', () => {
  it('knows the workspace, the SPL and the product from where you stand', () => {
    const ws = seededWorkspace(path.join(tmp, 'ws'));
    const line = createLocalModularLine({ workdir: ws, name: 'gis' });
    const productDir = path.join(line.dir, 'shop');
    fs.mkdirSync(path.join(productDir, '.linea'), { recursive: true });
    fs.writeFileSync(path.join(productDir, '.linea', 'spec.json'), '{}');
    fs.mkdirSync(path.join(productDir, 'src', 'deep'), { recursive: true });

    expect(findContext(path.join(productDir, 'src', 'deep'))).toEqual({
      workspace: ws,
      line: { name: 'gis', dir: line.dir },
      product: { name: 'shop', dir: productDir },
    });
    expect(findContext(line.dir).product).toBeUndefined();
    expect(findContext(ws).line).toBeUndefined();
    expect(findContext(tmp)).toEqual({});
  });
});

function streams() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out: { write: (s: string) => out.push(s) } as unknown as NodeJS.WriteStream,
    err: { write: (s: string) => err.push(s), isTTY: false } as unknown as NodeJS.WriteStream,
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
}

const sh = async (...argv: string[]) => {
  const s = streams();
  const code = await runShell(argv, s.out, s.err);
  return { code, out: s.stdout(), err: s.stderr() };
};

describe('linea <command> from a shell', () => {
  it('works from the folder you are in: SPL, then product, with no names repeated', async () => {
    const ws = seededWorkspace(path.join(tmp, 'ws'));
    process.chdir(ws);
    expect((await sh('spl', 'new', 'gis', '--plain', '--local')).code).toBe(0);
    const line = { dir: path.join(ws, 'gis') };

    process.chdir(line.dir);
    expect(await sh('spl', 'show')).toMatchObject({ code: 0 });
    expect((await sh('spl', 'show')).out).toMatch(/gis/);

    const made = await sh('product', 'new', 'shop');
    expect(made.err).toBe('');
    expect(made.code).toBe(0);
    expect(made.out).toMatch(/Created shop at/);

    process.chdir(path.join(line.dir, 'shop'));
    const shown = await sh('product', 'show');
    expect(shown.code).toBe(0);
    expect(shown.out).toMatch(/shop/);
  });

  it('exit codes: 2 when used wrong, 1 when it cannot, and errors on stderr', async () => {
    const bad = await sh('spl', 'bogus');
    expect(bad.code).toBe(2);
    expect(bad.out).toBe('');
    expect(bad.err).toMatch(/Unknown: spl bogus/);

    process.chdir(tmp);
    const none = await sh('fm', 'show');
    expect(none.code).toBe(1);
    expect(none.err).toMatch(/Not inside an SPL/);

    expect((await sh('spl', 'new')).code).toBe(2);
  });

  it('a command only the server can do asks you to sign in, and never starts without it', async () => {
    delete process.env['LINEA_TOKEN'];
    const r = await sh('namespaces');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/namespaces needs you signed in: run login/);
    expect(r.out).toBe('');
  });

  it('--json prints JSON (the data of the command, or ok and its message)', async () => {
    process.chdir(tmp);
    const j = await sh('doctor', '--json');
    expect(Array.isArray(JSON.parse(j.out))).toBe(true);
    const bad = await sh('spl', 'delete', '--json');
    expect(JSON.parse(bad.out)).toMatchObject({ ok: false });
  });

  it('creates an SPL made of modules, and a plain one with --plain', async () => {
    const ws = seededWorkspace(path.join(tmp, 'ws'));
    process.chdir(ws);
    const modular = await sh('spl', 'new', 'gis', '--local');
    expect(modular.code).toBe(0);
    expect(fs.existsSync(path.join(ws, 'gis', 'spl.json'))).toBe(true);

    const plain = await sh('spl', 'new', 'old', '--plain', '--local');
    expect(plain.code).toBe(0);
    // (every SPL has its spl.json now; a plain one asks for the feature metamodel only)
    expect(fs.readFileSync(path.join(ws, 'old', 'spl.json'), 'utf8')).toMatch(/"kind": "plain"/);
    expect(fs.existsSync(path.join(ws, 'old', 'src', 'platform'))).toBe(true);

    // models used to be picked here; they are metamodels of modules now, and a line that asks for them is told, not given them
    const asked = await sh('spl', 'new', 'older', '--plain', 'UML,SENSOR', '--local');
    expect(asked.code).toBe(0);
    expect(asked.out).toContain('--plain takes no models');
    expect(fs.readFileSync(path.join(ws, 'older', 'src', 'platform', 'transformation.js'), 'utf8')).not.toContain('processDataModel');
  });
});
