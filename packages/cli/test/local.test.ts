import { describe, it, expect, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  bumpLocalProductVersion,
  createLocalLine,
  createLocalProduct,
  deleteLocalLine,
  deleteLocalProduct,
  generateLocalProduct,
  healthLocalProduct,
  isLocalLineDir,
  listLocalLines,
  listLocalProducts,
  localProductDir,
  readLocalProductSpec,
  renameLocalProduct,
  resolveLocalLine,
  updateLocalProduct,
  writeLocalProductSpec,
} from '../src/core/workspace.js';
import { seedLocalProductModels } from '../src/core/workspace.js';
import { setLineModel, withFeatureMetamodel } from './helpers.js';

const created: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-cli-local-'));
  created.push(dir);
  // every SPL is made of the feature metamodel: the workspace holds it
  withFeatureMetamodel(dir);
  return dir;
}

afterEach(() => {
  while (created.length) {
    const dir = created.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('createLocalLine / listLocalLines / resolveLocalLine', () => {
  it('scaffolds a line with an empty products.json', () => {
    const workdir = tmpDir();
    const line = createLocalLine({ workdir, name: 'MyLine' });
    expect(line.dir).toBe(path.join(workdir, 'MyLine'));
    expect(fs.existsSync(path.join(line.dir, 'models', 'featuremodel.featuremodel'))).toBe(true);
    expect(fs.existsSync(path.join(line.dir, 'products.json'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(line.dir, 'products.json'), 'utf8'))).toEqual({
      productos: [],
    });
  });

  it('refuses to overwrite an existing non-empty line directory', () => {
    const workdir = tmpDir();
    createLocalLine({ workdir, name: 'Dup' });
    expect(() => createLocalLine({ workdir, name: 'Dup' })).toThrow(/already exists/);
  });

  it('lists only directories shaped like a line', () => {
    const workdir = tmpDir();
    createLocalLine({ workdir, name: 'A' });
    createLocalLine({ workdir, name: 'B' });
    fs.mkdirSync(path.join(workdir, 'not-a-line'));
    fs.writeFileSync(path.join(workdir, 'some-file.txt'), 'x');
    const names = listLocalLines(workdir).map((l) => l.name);
    expect(names).toEqual(['A', 'B']);
  });

  it('resolves a line by name (case-insensitive) or by explicit path', () => {
    const workdir = tmpDir();
    const line = createLocalLine({ workdir, name: 'MixedCase' });
    expect(resolveLocalLine(workdir, 'mixedcase').dir).toBe(line.dir);
    expect(resolveLocalLine(workdir, line.dir).dir).toBe(line.dir);
  });

  it('throws a friendly error for an unknown line', () => {
    const workdir = tmpDir();
    expect(() => resolveLocalLine(workdir, 'nope')).toThrow(/No local line named/);
  });
});

describe('createLocalProduct', () => {
  async function lineWithFeature(): Promise<string> {
    const workdir = tmpDir();
    const line = createLocalLine({ workdir, name: 'Shop' });
    // Give it a real optional feature beyond the seed root.
    await setLineModel(line.dir, 'features\n\tShop\n\t\tmandatory\n\t\t\tCore\n\t\toptional\n\t\t\tGreeting\n');
    return line.dir;
  }

  it('writes .linea/spec.json and registers the product in products.json', async () => {
    const lineDir = await lineWithFeature();
    const created2 = createLocalProduct({
      lineDir,
      spec: { basicData: { name: 'Greeter', version: '0.1.0' }, features: ['Greeting'] },
    });
    expect(created2.name).toBe('Greeter');
    expect(created2.dir).toBe(localProductDir(lineDir, 'Greeter'));
    expect(fs.existsSync(path.join(created2.dir, '.linea', 'spec.json'))).toBe(true);

    const index = listLocalProducts(lineDir);
    expect(index).toEqual([{ name: 'Greeter', repositorio: 'Greeter', version: '0.1.0' }]);

    const spec = readLocalProductSpec(created2.dir);
    expect(spec.basicData?.name).toBe('Greeter');
    // normalizeProductSpec defaults applied
    expect(spec.dataModel?.cells).toEqual([]);
  });

  it('rejects a spec with an invalid name', async () => {
    const lineDir = await lineWithFeature();
    expect(() =>
      createLocalProduct({ lineDir, spec: { basicData: { name: 'bad name!', version: '0.0.1' } } }),
    ).toThrow(/Invalid product spec/);
  });

  it('refuses a duplicate product name', async () => {
    const lineDir = await lineWithFeature();
    createLocalProduct({ lineDir, spec: { basicData: { name: 'Dup', version: '0.0.1' } } });
    expect(() =>
      createLocalProduct({ lineDir, spec: { basicData: { name: 'Dup', version: '0.0.2' } } }),
    ).toThrow(/already exists/);
  });
});

describe('generateLocalProduct', () => {
  it('bumps the patch version and persists it in both the spec and products.json', async () => {
    const workdir = tmpDir();
    const line = createLocalLine({ workdir, name: 'Bump' });
    await setLineModel(line.dir, 'features\n\tBump\n\t\tmandatory\n\t\t\tCore\n');
    const dir = localProductDir(line.dir, 'P');
    writeLocalProductSpec(dir, { basicData: { name: 'P', version: '1.2.3' }, features: [] });
    await seedLocalProductModels(workdir, line.dir, dir);
    // Seed the index entry the way createLocalProduct would.
    fs.writeFileSync(
      path.join(line.dir, 'products.json'),
      JSON.stringify({ productos: [{ name: 'P', repositorio: 'P', version: '1.2.3' }] }, null, 2) + '\n',
    );

    const { version, outputDir } = await generateLocalProduct(line.dir, 'P');
    expect(version).toBe('1.2.4');
    expect(outputDir).toBe(dir);
    expect(readLocalProductSpec(dir).basicData?.version).toBe('1.2.4');
    expect(listLocalProducts(line.dir)).toEqual([{ name: 'P', repositorio: 'P', version: '1.2.4' }]);
  });
});

describe('deleteLocalLine', () => {
  it('removes the whole line directory, including nested products', () => {
    const workdir = tmpDir();
    const line = createLocalLine({ workdir, name: 'Doomed' });
    writeLocalProductSpec(localProductDir(line.dir, 'P'), { basicData: { name: 'P', version: '0.0.1' } });
    expect(fs.existsSync(line.dir)).toBe(true);

    deleteLocalLine(line.dir);

    expect(fs.existsSync(line.dir)).toBe(false);
    expect(listLocalLines(workdir)).toEqual([]);
  });

  it('GUARD: refuses to delete a directory that is not a local line, instead of silently no-op-ing', () => {
    const workdir = tmpDir();
    // A directory that exists but has no src/platform — e.g. exactly what a
    // stale CLOUD Mongo id ("24-hex-chars") would resolve to relative to cwd
    // if it ever reached here (the bug this guard exists to turn into a loud
    // error instead of a silent, misleading "success").
    const notALine = path.join(workdir, 'not-a-line');
    fs.mkdirSync(notALine);
    fs.writeFileSync(path.join(notALine, 'decoy.txt'), 'x');

    expect(() => deleteLocalLine(notALine)).toThrow(/doesn't look like a local SPL/);
    expect(fs.existsSync(notALine)).toBe(true); // untouched

    // A path that doesn't exist at all fails the same guard, the same way —
    // no more "idempotent" silent success for a nonexistent target either.
    expect(() => deleteLocalLine(path.join(workdir, 'never-existed'))).toThrow(/doesn't look like a local SPL/);
  });
});

describe('updateLocalProduct', () => {
  function lineWithProduct(): { lineDir: string; productDir: string } {
    const workdir = tmpDir();
    const line = createLocalLine({ workdir, name: 'Shop' });
    fs.writeFileSync(
      path.join(line.dir, 'src', 'platform', 'model.uvl'),
      'features\n\tShop\n\t\tmandatory\n\t\t\tCore\n\t\toptional\n\t\t\tGreeting\n',
    );
    const created = createLocalProduct({
      lineDir: line.dir,
      spec: { basicData: { name: 'Greeter', version: '0.1.0' }, features: [] },
    });
    return { lineDir: line.dir, productDir: created.dir };
  }

  it('replaces the spec and bumps the SUBMITTED version by a minor (index 1), matching updateProduct', () => {
    const { lineDir, productDir } = lineWithProduct();
    const { spec } = updateLocalProduct({
      lineDir,
      name: 'Greeter',
      spec: { basicData: { name: 'Greeter', version: '0.1.0' }, features: ['Greeting'] },
    });
    // 0.1.0 -> 0.2.0 (index 1 = minor), NOT the patch bump /generate does.
    expect(spec.basicData?.version).toBe('0.2.0');
    expect(readLocalProductSpec(productDir).basicData?.version).toBe('0.2.0');
    expect(listLocalProducts(lineDir)).toEqual([{ name: 'Greeter', repositorio: 'Greeter', version: '0.2.0' }]);
  });

  it('refuses to rename the product via a spec name change', () => {
    const { lineDir } = lineWithProduct();
    expect(() =>
      updateLocalProduct({
        lineDir,
        name: 'Greeter',
        spec: { basicData: { name: 'NotGreeter', version: '0.1.0' } },
      }),
    ).toThrow(/can't rename/);
  });

  it('throws a friendly error for a product that does not exist', () => {
    const { lineDir } = lineWithProduct();
    expect(() =>
      updateLocalProduct({ lineDir, name: 'Nope', spec: { basicData: { name: 'Nope', version: '0.0.1' } } }),
    ).toThrow(/No spec found/);
  });
});

describe('isLocalLineDir', () => {
  it('is true for a real local line and false otherwise', () => {
    const workdir = tmpDir();
    const line = createLocalLine({ workdir, name: 'Real' });
    expect(isLocalLineDir(line.dir)).toBe(true);
    expect(isLocalLineDir(path.join(workdir, 'nonexistent'))).toBe(false);
    fs.mkdirSync(path.join(workdir, 'empty-dir'));
    expect(isLocalLineDir(path.join(workdir, 'empty-dir'))).toBe(false);
  });
});

describe('bumpLocalProductVersion', () => {
  it('SELF-HEALS: adds the index entry instead of silently doing nothing when it is missing', () => {
    const workdir = tmpDir();
    const line = createLocalLine({ workdir, name: 'Drifted' });
    const dir = localProductDir(line.dir, 'Ghost');
    writeLocalProductSpec(dir, { basicData: { name: 'Ghost', version: '1.0.0' } });
    // products.json never got an entry for it (simulates the drift the review flagged).
    // it is found anyway: a folder with a spec is a product, whatever the index says
    expect(listLocalProducts(line.dir).map((p) => p.name)).toEqual(['Ghost']);

    bumpLocalProductVersion(line.dir, 'Ghost', '1.0.1');

    expect(listLocalProducts(line.dir)).toEqual([{ name: 'Ghost', repositorio: 'Ghost', version: '1.0.1' }]);
  });

  it('updates the existing entry in place when it is already there', () => {
    const workdir = tmpDir();
    const line = createLocalLine({ workdir, name: 'NotDrifted' });
    createLocalProduct({ lineDir: line.dir, spec: { basicData: { name: 'P', version: '1.0.0' } } });

    bumpLocalProductVersion(line.dir, 'P', '2.0.0');

    expect(listLocalProducts(line.dir)).toEqual([{ name: 'P', repositorio: 'P', version: '2.0.0' }]);
  });
});

describe('deleteLocalProduct', () => {
  it('removes the product directory and its products.json entry', () => {
    const workdir = tmpDir();
    const line = createLocalLine({ workdir, name: 'Shop' });
    const created = createLocalProduct({ lineDir: line.dir, spec: { basicData: { name: 'P', version: '0.0.1' } } });
    expect(fs.existsSync(created.dir)).toBe(true);

    deleteLocalProduct(line.dir, 'P');

    expect(fs.existsSync(created.dir)).toBe(false);
    expect(listLocalProducts(line.dir)).toEqual([]);
  });

  it('throws a friendly error for a product that does not exist', () => {
    const workdir = tmpDir();
    const line = createLocalLine({ workdir, name: 'Shop' });
    expect(() => deleteLocalProduct(line.dir, 'Nope')).toThrow(/No local product named/);
  });
});

describe('renameLocalProduct', () => {
  function lineWithProduct(): { lineDir: string } {
    const workdir = tmpDir();
    const line = createLocalLine({ workdir, name: 'Shop' });
    createLocalProduct({ lineDir: line.dir, spec: { basicData: { name: 'Old', version: '1.2.3' } } });
    return { lineDir: line.dir };
  }

  it('moves the directory, updates the spec name, and keeps the version in the index', () => {
    const { lineDir } = lineWithProduct();
    const { dir } = renameLocalProduct(lineDir, 'Old', 'New');

    expect(dir).toBe(localProductDir(lineDir, 'New'));
    expect(fs.existsSync(localProductDir(lineDir, 'Old'))).toBe(false);
    expect(readLocalProductSpec(dir).basicData?.name).toBe('New');
    expect(listLocalProducts(lineDir)).toEqual([{ name: 'New', repositorio: 'New', version: '1.2.3' }]);
  });

  it('refuses when the source does not exist', () => {
    const { lineDir } = lineWithProduct();
    expect(() => renameLocalProduct(lineDir, 'Nope', 'New')).toThrow(/No local product named/);
  });

  it('refuses when the target name is already taken', () => {
    const { lineDir } = lineWithProduct();
    createLocalProduct({ lineDir, spec: { basicData: { name: 'Taken', version: '0.0.1' } } });
    expect(() => renameLocalProduct(lineDir, 'Old', 'Taken')).toThrow();
    // Untouched — the index-level check ran before any fs mutation.
    expect(fs.existsSync(localProductDir(lineDir, 'Old'))).toBe(true);
  });
});

describe('healthLocalProduct', () => {
  // the product's feature selection is a model of its own: health is whether it fits the SPL's feature model
  const productOf = async (): Promise<{ lineDir: string; productDir: string }> => {
    const workdir = tmpDir();
    const line = createLocalLine({ workdir, name: 'Shop' });
    await setLineModel(line.dir, 'features\n\tShop\n\t\tmandatory\n\t\t\tCore\n\t\toptional\n\t\t\tGreeting\n');
    const made = createLocalProduct({ lineDir: line.dir, spec: { basicData: { name: 'Greeter', version: '0.1.0' }, features: ['Greeting'] } });
    await seedLocalProductModels(workdir, line.dir, made.dir);
    return { lineDir: line.dir, productDir: made.dir };
  };

  it('reports valid for a selection the model admits', async () => {
    const { lineDir, productDir } = await productOf();
    fs.writeFileSync(path.join(productDir, '.linea', 'models', 'featureselection.featureselection'), 'selection of Shop {\n  select Core\n  select Greeting\n}\n');
    const h = await healthLocalProduct(lineDir, 'Greeter');
    expect(h.valid).toBe(true);
    expect(h.error).toBeNull();
  });

  it('reports invalid, without throwing, when the model no longer admits the selection', async () => {
    const { lineDir, productDir } = await productOf();
    fs.writeFileSync(path.join(productDir, '.linea', 'models', 'featureselection.featureselection'), 'selection of Shop {\n  select Core\n  select Ghost\n}\n');
    const h = await healthLocalProduct(lineDir, 'Greeter');
    expect(h.valid).toBe(false);
    expect(h.error).not.toBeNull();
  });
});
