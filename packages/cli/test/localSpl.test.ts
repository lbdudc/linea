import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { makeSession, newPlainLine, run, useNoNetwork, useTmpDirs, setLineModel } from './helpers.js';

// The commands that work on the folders of an SPL (new, product, generate, fm, check, delete), driven through the real Command.run()
// functions over a real scaffold and a real spl-js-engine derivation, and guarded so that none of them ever reaches for the network.

const tmpDir = useTmpDirs('linea-cli-spl');
const network = useNoNetwork();

const MODEL = 'features\n\tShop\n\t\tmandatory\n\t\t\tCore\n\t\toptional\n\t\t\tGreeting\n';
const writeModel = (lineDir: string, content = MODEL) => setLineModel(lineDir, content);
const writeSpec = (dir: string, spec: object, name = 'spec.json') => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(spec));
  return file;
};

describe('spl new, product new and generate', () => {
  it('derives a real product with deriveProduct, produces the expected file tree, and touches no network', async () => {
    const workdir = tmpDir();
    const session = makeSession(workdir);

    // an SPL, and the session is in it
    expect(await run(session, 'spl new', 'Shop', '--plain', '--local')).toContain('Created Shop');
    const lineDir = session.cwd!;
    expect(lineDir).toBe(path.join(workdir, 'Shop'));

    await writeModel(lineDir);
    // real annotated source (the /*% %*/ delimiter matches DEFAULT_PLATFORM_CONFIG for .md), consumed by the scaffolded extra.js/transformation.js
    fs.writeFileSync(
      path.join(lineDir, 'src', 'platform', 'code', 'README.md'),
      '# /*%= data.basicData.name %*/\n' + '/*% if (feature.Greeting) { %*/\nHello!\n/*% } %*/\n',
    );

    const created = await run(session, 'product new', '--from', writeSpec(workdir, { basicData: { name: 'Greeter', version: '0.1.0' }, features: ['Greeting'] }));
    expect(created).toContain('Created Greeter');
    expect(fs.existsSync(path.join(lineDir, 'Greeter', '.linea', 'spec.json'))).toBe(true);

    // generate, with no flag, derives into the product's own folder
    expect(await run(session, 'generate', 'Greeter')).toContain('✓ Generated Greeter (v0.1.1)');
    const readme = fs.readFileSync(path.join(lineDir, 'Greeter', 'README.md'), 'utf8');
    expect(readme).toContain('Greeter');
    expect(readme).toContain('Hello!');

    // the bump is in the product's spec and in the SPL's index
    const spec = JSON.parse(fs.readFileSync(path.join(lineDir, 'Greeter', '.linea', 'spec.json'), 'utf8'));
    expect(spec.spec.basicData.version).toBe('0.1.1');
    expect(JSON.parse(fs.readFileSync(path.join(lineDir, 'products.json'), 'utf8')).productos).toEqual([{ name: 'Greeter', repositorio: 'Greeter', version: '0.1.1' }]);
    expect(network.calls()).toBe(0);
  });

  it('--preview <dir> derives somewhere else and leaves the spec and the version alone', async () => {
    const workdir = tmpDir();
    const session = makeSession(workdir);
    const lineDir = await newPlainLine(session, 'Preview');
    await writeModel(lineDir, 'features\n\tPreview\n\t\tmandatory\n\t\t\tCore\n');
    fs.writeFileSync(path.join(lineDir, 'src', 'platform', 'code', 'README.md'), '# /*%= data.basicData.name %*/\n');
    await run(session, 'product new', '--from', writeSpec(workdir, { basicData: { name: 'P', version: '0.0.1' } }));

    const previewDir = path.join(workdir, 'preview-out');
    expect(await run(session, 'generate', 'P', '--preview', previewDir)).toContain('preview');
    expect(fs.existsSync(path.join(previewDir, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(lineDir, 'P', 'README.md'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(lineDir, 'P', '.linea', 'spec.json'), 'utf8')).spec.basicData.version).toBe('0.0.1');
    expect(network.calls()).toBe(0);
  });

  it('a preview with no folder never collides with an SPL of the same name', async () => {
    const workdir = tmpDir();
    const session = makeSession(workdir);
    // an SPL called "Shop": its folder is <workdir>/Shop
    const shopLine = await newPlainLine(session, 'Shop');
    const scaffoldFile = path.join(shopLine, 'src', 'platform', 'config.json');
    expect(fs.existsSync(scaffoldFile)).toBe(true);

    // another SPL, with a PRODUCT also called "Shop": the old default (<workdir>/<product>) derived straight into the SPL above
    const other = await newPlainLine(session, 'OtherLine');
    await writeModel(other, 'features\n\tOtherLine\n\t\tmandatory\n\t\t\tCore\n');
    fs.writeFileSync(path.join(other, 'src', 'platform', 'code', 'README.md'), '# hi\n');
    await run(session, 'product new', '--from', writeSpec(workdir, { basicData: { name: 'Shop', version: '0.0.1' } }));

    expect(await run(session, 'generate', 'Shop', '--preview')).toContain('✓ Generated into');
    expect(fs.existsSync(scaffoldFile)).toBe(true);
    expect(fs.existsSync(path.join(shopLine, 'README.md'))).toBe(false);
    expect(fs.existsSync(path.join(workdir, '.previews', 'Shop', 'README.md'))).toBe(true);
  });

  it('refuses to preview into an SPL folder, before anything is written', async () => {
    const workdir = tmpDir();
    const session = makeSession(workdir);
    const shopLine = await newPlainLine(session, 'Shop');
    const other = await newPlainLine(session, 'OtherLine');
    await writeModel(other, 'features\n\tOtherLine\n\t\tmandatory\n\t\t\tCore\n');
    fs.writeFileSync(path.join(other, 'src', 'platform', 'code', 'README.md'), '# hi\n');
    await run(session, 'product new', '--from', writeSpec(workdir, { basicData: { name: 'P', version: '0.0.1' } }));

    await expect(run(session, 'generate', 'P', '--preview', shopLine)).rejects.toThrow(/Refusing to write/);
    expect(fs.existsSync(path.join(shopLine, 'src', 'platform', 'config.json'))).toBe(true);
    expect(fs.existsSync(path.join(shopLine, 'README.md'))).toBe(false);
  });

  it('--zip derives straight to a .zip file without touching the product folder', async () => {
    const workdir = tmpDir();
    const session = makeSession(workdir);
    const lineDir = await newPlainLine(session, 'Shop');
    await writeModel(lineDir, 'features\n\tShop\n\t\tmandatory\n\t\t\tCore\n');
    await run(session, 'product new', '--from', writeSpec(workdir, { basicData: { name: 'Z', version: '0.0.1' } }));

    const zipFile = path.join(workdir, 'out.zip');
    expect(await run(session, 'generate', 'Z', '--zip', zipFile)).toContain('out.zip');
    expect(fs.readFileSync(zipFile).subarray(0, 2).toString('latin1')).toBe('PK');
    expect(fs.existsSync(path.join(lineDir, 'Z', 'README.md'))).toBe(false);
    expect(network.calls()).toBe(0);
  });

  it('--remote asks the server for the id the product was cloned with, and says when it has none', async () => {
    const workdir = tmpDir();
    const session = makeSession(workdir);
    const lineDir = await newPlainLine(session, 'Shop');
    await run(session, 'product new', '--from', writeSpec(workdir, { basicData: { name: 'P', version: '0.0.1' } }));
    session.authed = true; // signed in from here on
    // made here, so LINEA does not have it: no request is made
    await expect(run(session, 'generate', 'P', '--remote')).rejects.toThrow(/is not on LINEA yet/);
    expect(network.calls()).toBe(0);

    // cloned from LINEA: the id it has there is the one asked for
    fs.mkdirSync(path.join(lineDir, 'P', '.linea'), { recursive: true });
    fs.writeFileSync(path.join(lineDir, 'P', '.linea', 'origin.json'), JSON.stringify({ kind: 'product', name: 'P', provider: 'gitlab', projectId: 5, webUrl: 'x', defaultBranch: 'main', productId: 'abc123' }));
    const requested: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      requested.push(`${init?.method} ${new URL(String(input)).pathname}`);
      const body = String(input).endsWith('/pipeline') ? { pipeline: { status: 'success' }, jobs: [] } : { spec: { basicData: { version: '0.0.2' } } };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    try {
      expect(await run(session, 'generate', 'P', '--remote')).toContain('✓ Generated on LINEA (v0.0.2)');
      expect(requested[0]).toBe('POST /api/products/abc123/generate');
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('looking at an SPL never needs the network', () => {
  it('spl list --local, spl show, fm show and product list', async () => {
    const workdir = tmpDir();
    const session = makeSession(workdir, { local: true });
    await newPlainLine(session, 'Solo');
    expect(await run(session, 'spl list')).toContain('Solo');
    expect(await run(session, 'spl show')).toContain('SPL: Solo (plain)');
    expect(await run(session, 'fm show')).toContain('features');
    expect(await run(session, 'product list')).toContain('No products');
    expect(network.calls()).toBe(0);
  });
});

describe('spl delete', () => {
  it('asks to be told the name, deletes with it, and moves out of the folder it deleted', async () => {
    const workdir = tmpDir();
    const session = makeSession(workdir);
    const lineDir = await newPlainLine(session, 'Doomed');

    expect(await run(session, 'spl delete')).toContain('Re-run as: spl delete Doomed --yes');
    // --yes alone is not enough to delete whatever folder you happen to be in
    expect(await run(session, 'spl delete', '--yes')).toContain('Re-run as: spl delete Doomed --yes');
    expect(fs.existsSync(lineDir)).toBe(true);

    expect(await run(session, 'spl delete', 'Doomed', '--yes')).toContain('Deleted "Doomed" from this machine');
    expect(fs.existsSync(lineDir)).toBe(false);
    expect(session.cwd).toBe(workdir);
    expect(network.calls()).toBe(0);
  });
});

describe('products', () => {
  async function shopWithGreeter(): Promise<{ session: ReturnType<typeof makeSession>; lineDir: string; workdir: string }> {
    const workdir = tmpDir();
    const session = makeSession(workdir);
    const lineDir = await newPlainLine(session, 'Shop');
    await writeModel(lineDir);
    await run(session, 'product new', '--from', writeSpec(workdir, { basicData: { name: 'Greeter', version: '0.1.0' }, features: ['Greeting'] }));
    return { session, lineDir, workdir };
  }

  it('update replaces the spec and bumps the minor version', async () => {
    const { session, workdir } = await shopWithGreeter();
    const next = writeSpec(workdir, { basicData: { name: 'Greeter', version: '0.1.0' }, features: ['Greeting'] }, 'next.json');
    expect(await run(session, 'product update', 'Greeter', next)).toContain('Updated Greeter (v0.2.0)');
    expect(network.calls()).toBe(0);
  });

  it('check says whether the features fit the SPL', async () => {
    const { session } = await shopWithGreeter();
    expect(await run(session, 'check', 'Greeter')).toContain('fit the SPL');
    expect(network.calls()).toBe(0);
  });

  it('features can be listed, added and taken away, and one that does not exist is refused', async () => {
    const { session } = await shopWithGreeter();
    expect(await run(session, 'product features', 'Greeter')).toContain('Greeting');
    await expect(run(session, 'product features', 'Greeter', '--add', 'Ghost')).rejects.toThrow();
    expect(await run(session, 'product features', 'Greeter', '--remove', 'Greeting')).toContain('now selects: nothing');
  });

  it('rename moves the folder, and the list follows', async () => {
    const { session, lineDir } = await shopWithGreeter();
    expect(await run(session, 'product rename', 'Greeter', 'Hello')).toContain('Renamed to Hello');
    expect(fs.existsSync(path.join(lineDir, 'Hello', '.linea', 'spec.json'))).toBe(true);
    expect(fs.existsSync(path.join(lineDir, 'Greeter'))).toBe(false);
    const list = await run(session, 'product list');
    expect(list).toContain('Hello');
    expect(list).not.toContain('Greeter');
  });

  it('delete refuses without --yes, then removes the product on --yes', async () => {
    const { session, lineDir } = await shopWithGreeter();
    expect(await run(session, 'product delete', 'Greeter')).toContain('Re-run with --yes');
    expect(fs.existsSync(path.join(lineDir, 'Greeter'))).toBe(true);
    expect(await run(session, 'product delete', 'Greeter', '--yes')).toContain('Deleted "Greeter"');
    expect(fs.existsSync(path.join(lineDir, 'Greeter'))).toBe(false);
  });

  it('a product is found by its name whatever the case, and a wrong name says what there is', async () => {
    const { session } = await shopWithGreeter();
    expect(await run(session, 'product show', 'greeter')).toContain('Product: Greeter');
    await expect(run(session, 'product show', 'nope')).rejects.toThrow(/No product "nope" in Shop\. It has: Greeter/);
  });

  it('outside an SPL, a command about one says how to get into it', async () => {
    const workdir = tmpDir();
    await expect(run(makeSession(workdir), 'product list')).rejects.toThrow(/Not inside an SPL/);
  });
});
