import { withFeatureMetamodel } from './helpers.js';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getCommand } from '../src/commands/registry.js';
import type { CommandContext, Session } from '../src/commands/types.js';
import { createLocalProduct, generateLocalProduct, localProductDir, readLocalModelAsUvl } from '../src/core/workspace.js';
import {
  checkLocalLine,
  checkLocalProductModels,
  createLocalModularLine,
  createLocalPackage,
  getLocalLineModules,
  listLocalPackages,
  readLocalProductModels,
  seedLocalProductModels,
  setLocalLineModules,
} from '../src/core/workspace.js';

// LOCAL mode of a line made of modules, over real folders and the real linea-core and bango (nothing is mocked).

const DATAMODEL = `grammar Datamodel

// Data model: entities, with fields that may point at other entities
entry Model: 'datamodel' name=ID? (entities+=Entity)*;

Entity: 'entity' name=ID '{' (fields+=Field)* '}';

Field: 'field' name=ID ('->' target=[Entity:ID])?;

terminal ID: /[_a-zA-Z][\\w_-]*/;
hidden terminal WS: /\\s+/;
`;

let workdir: string;

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-cli-modular-'));
  withFeatureMetamodel(workdir);
});
afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

/** A metamodel and a module that uses it and offers a model, in the workspace. */
// (the workspace also holds the feature metamodel every SPL is made of, and what it needs: those are not what these tests are about)
const SEEDED = ['common', 'featuremodel'];
const own = () => listLocalPackages(workdir).filter((p) => !SEEDED.includes(p.name));

function seedWorkspace() {
  const mm = createLocalPackage({ workdir, kind: 'metamodel', name: 'datamodel' });
  write(path.join(mm.dir, 'grammars', 'datamodel.langium'), DATAMODEL);

  const mod = createLocalPackage({ workdir, kind: 'module', name: 'user-management' });
  write(
    path.join(mod.dir, '.linea', 'module.json'),
    JSON.stringify({
      name: 'user-management',
      version: '0.1.0',
      requires: { modules: {}, metamodels: { [mm.location]: '^0.1.0' } },
      offers: { datamodel: 'models/datamodel.instance' },
    }),
  );
  write(path.join(mod.dir, '.linea', 'model.uvl'), 'features\n\tUserManagement\n\t\toptional\n\t\t\tProfile\n');
  write(path.join(mod.dir, 'models', 'datamodel.instance'), 'datamodel um\n\nentity UM_User {\n  field login\n}\n');
  write(path.join(mod.dir, '.linea', 'config', 'transformation.js'), 'registerMetamodelProcessor(function (ret, input) {\n  ret.data.models = input.modelsByMetamodel;\n});\n');
  write(
    path.join(mod.dir, 'code', 'server', 'users.js'),
    '/*% if (feature.Profile) { %*/\nexport const profile = true;\n/*% } %*/\nexport const models = /*%= JSON.stringify(data.models) %*/;\n',
  );
  return { mm, mod };
}

const spec = (name: string, features: string[]) => ({
  basicData: { name, version: '0.0.0', languages: ['en'] },
  dataModel: { cells: [] },
  features,
  statics: [],
});

describe('packages', () => {
  it('lists what the workspace holds, with versions', () => {
    seedWorkspace();
    expect(own().map((p) => `${p.kind}:${p.name}@${p.version}`)).toEqual([
      'module:user-management@0.1.0',
      'metamodel:datamodel@0.1.0',
    ]);
  });

  it('refuses a name that is not valid, and a folder that is taken', () => {
    expect(() => createLocalPackage({ workdir, kind: 'module', name: 'a b' })).toThrow(/not a valid name/);
    createLocalPackage({ workdir, kind: 'module', name: 'taken' });
    expect(() => createLocalPackage({ workdir, kind: 'module', name: 'taken' })).toThrow(/already exists/);
  });

  it('does not list folders that are not packages', () => {
    fs.mkdirSync(path.join(workdir, 'modules', 'junk'), { recursive: true });
    write(path.join(workdir, 'modules', 'broken', '.linea', 'module.json'), '{');
    expect(own()).toEqual([]);
  });
});

describe('a line made of modules', () => {
  it('resolves what the modules need, checks it, and writes the lockfile', async () => {
    const { mod } = seedWorkspace();
    const line = createLocalModularLine({ workdir, name: 'gis' });
    expect((await getLocalLineModules(workdir, line.dir)).modules).toEqual({});

    const { resolved } = await setLocalLineModules(workdir, line.dir, { [mod.location]: '^0.1.0' });
    expect(resolved.metamodels.map((m) => m.manifest.name)).toContain('datamodel');
    const lock = JSON.parse(fs.readFileSync(path.join(line.dir, 'linea.lock.json'), 'utf8')) as { packages: Record<string, unknown> };
    expect(Object.keys(lock.packages)).toEqual(expect.arrayContaining(['file:metamodels/datamodel', 'file:modules/user-management']));

    const view = await getLocalLineModules(workdir, line.dir);
    expect(view.packages.map((p) => p.name)).toEqual(expect.arrayContaining(['user-management', 'datamodel']));
    expect(readLocalModelAsUvl(line.dir)).toContain('Profile');
  });

  it('does not save modules that do not fit', async () => {
    const { mod } = seedWorkspace();
    write(path.join(mod.dir, 'models', 'datamodel.instance'), 'datamodel um\n\nentity A {\n  field f -> Nowhere\n}\n');
    const line = createLocalModularLine({ workdir, name: 'gis' });
    await expect(setLocalLineModules(workdir, line.dir, { [mod.location]: '^0.1.0' })).rejects.toThrow(/do not fit together/);
    expect(JSON.parse(fs.readFileSync(path.join(line.dir, 'spl.json'), 'utf8')).modules).toEqual({});
    const { report } = await checkLocalLine(workdir, line.dir, { [mod.location]: '^0.1.0' });
    expect(report.ok).toBe(false);
  });
});

describe('products of a modular line', () => {
  it('start with a model of each metamodel, are checked against the modules, and are generated with them', async () => {
    const { mod } = seedWorkspace();
    const line = createLocalModularLine({ workdir, name: 'gis' });
    await setLocalLineModules(workdir, line.dir, { [mod.location]: '^0.1.0' });

    // (a feature selection is checked against the composed feature model when the product is checked, not when it is made)
    const created = createLocalProduct({ lineDir: line.dir, spec: spec('Shop', ['Gis', 'Profile']) });

    expect(await seedLocalProductModels(workdir, line.dir, created.dir)).toContain(path.join('.linea', 'models', 'datamodel.datamodel'));
    expect((await checkLocalProductModels(workdir, line.dir, created.dir)).ok).toBe(true);

    // a model may refer to what a module offers (read-only)
    write(path.join(created.dir, '.linea', 'models', 'datamodel.datamodel'), 'datamodel shop\n\nentity Order {\n  field owner -> UM_User\n}\n');
    const checked = await checkLocalProductModels(workdir, line.dir, created.dir);
    expect(checked.ok).toBe(true);
    expect(checked.offered.map((o) => o.origin)).toEqual(['user-management']);

    // the product's feature selection is a model of its own now (the features of the spec are where it starts)
    write(path.join(created.dir, '.linea', 'models', 'featureselection.featureselection'), 'selection of Gis {\n  select UserManagement\n  select Profile\n}\n');
    const { outputDir, version } = await generateLocalProduct(line.dir, 'Shop');
    expect(version).toBe('0.0.1');
    const users = fs.readFileSync(path.join(outputDir, 'server', 'users.js'), 'utf8');
    expect(users).toContain('export const profile = true;');
    expect(users).toContain('Order');
    expect(Object.keys(readLocalProductModels(created.dir))).toContain('datamodel');

    // ...and a model that does not fit stops generation
    write(path.join(created.dir, '.linea', 'models', 'datamodel.datamodel'), 'datamodel shop\n\nentity Order {\n  field owner -> Nobody\n}\n');
    await expect(generateLocalProduct(line.dir, 'Shop')).rejects.toThrow(/does not fit its SPL/);
  });

  it('a folder that is not an SPL is refused: no models are seeded', async () => {
    const plain = path.join(workdir, 'plain');
    fs.mkdirSync(plain, { recursive: true });
    await expect(seedLocalProductModels(workdir, plain, path.join(plain, 'P'))).rejects.toThrow(/not a line made of modules/);
  });
});

describe('commands', () => {
  // signed out, so nothing is made on LINEA: the folders are what is worked on
  const session = (patch: Partial<Session> = {}): Session => ({ baseUrl: '', authed: false, workdir, cwd: workdir, ...patch });
  const run = async (name: string, args: string[], s: Session) => {
    const patches: Partial<Session>[] = [];
    const ctx: CommandContext = {
      args,
      rest: args.join(' '),
      session: s,
      updateSession: (patch) => {
        patches.push(patch);
        Object.assign(s, patch);
      },
      setStatus: () => undefined,
      print: () => undefined,
      clear: () => undefined,
      exit: () => undefined,
    };
    const output = await getCommand(name)!.run(ctx);
    return { output, patches };
  };

  it('drive the whole flow: packages, a modular line, modules, a check', async () => {
    const s = session();
    expect((await run('module list', [], s)).output).toContain('No modules');
    await run('metamodel new', ['sensors', 'Sensors'], s);
    await run('module new', ['monitoring'], s);
    expect((await run('metamodel list', [], s)).output).toMatch(/metamodel\s+sensors\s+v0\.1\.0.*Sensors/);

    // the module needs the metamodel (edited by hand, as a user would)
    const manifest = path.join(workdir, 'modules', 'monitoring', '.linea', 'module.json');
    const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    parsed.requires.metamodels['file:metamodels/sensors'] = '^0.1.0';
    fs.writeFileSync(manifest, JSON.stringify(parsed));

    const made = await run('spl new', ['stations', '--local'], s);
    expect(made.output).toContain('Created stations');
    // the session is in the new SPL: that is what the commands that follow are about
    expect(s.cwd).toBe(path.join(workdir, 'stations'));

    expect((await run('spl modules', [], s)).output).toContain('No modules yet');
    expect((await run('spl add', ['monitoring'], s)).output).toContain('✓ monitoring added');
    const listed = (await run('spl modules', [], s)).output;
    expect(listed).toContain('monitoring  ^0.1.0');
    expect(listed).toContain('metamodel  sensors  v0.1.0');
    expect((await run('check', [], s)).output).toContain('✓ The modules fit together');

    expect((await run('spl remove', ['monitoring'], s)).output).toContain('✓ monitoring removed');
    expect((await run('spl add', ['ghost'], s).catch((e) => String(e)))).toContain('No module "ghost"');
  });

  it('explain a module that does not fit instead of throwing', async () => {
    const { mod } = seedWorkspace();
    write(path.join(mod.dir, 'models', 'datamodel.instance'), 'datamodel um\n\nentity A {\n  field f -> Nowhere\n}\n');
    const s = session();
    await run('spl new', ['stations', '--local'], s);
    const { output } = await run('spl add', ['user-management'], s);
    expect(output).toContain('✗ They do not fit together');
    expect(output).toContain('Nowhere');
  });

  it('refuse to work on an SPL that is not made of modules', async () => {
    const s = session();
    await run('spl new', ['plain', '--plain', '--local'], s); // a classic SPL, and the session is in it
    await expect(run('spl modules', [], s)).rejects.toThrow(/not made of modules/);
  });
});
