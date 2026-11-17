import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, describe, vi } from 'vitest';
import { createFsPackageSource, createMemoryPackageSource, describeCips } from '@lbdudc/linea-core';
import { checkModuleTrial, deriveModuleTrial, describeModuleTrial, sourceWithChanges, withChanges, withMainsElsewhere } from '../model/services/modules/packageTrial.js';

vi.setConfig({ testTimeout: 90_000 });

const linea = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const hasPackages = fs.existsSync(path.join(linea, 'modules/data-management-component')) && fs.existsSync(path.join(linea, 'metamodels/basic'));
const LOCATION = 'file:modules/data-management-component';

describe('withChanges', () => {
  const memory = createMemoryPackageSource({ packages: { 'm:a': { '1.0.0': { 'code/one.js': 'one', 'code/two.js': 'two', 'README.md': 'r' } } } });
  const open = () => memory.open({ location: 'm:a', version: '1.0.0' });
  const text = async (files, file) => {
    const bytes = await files.read({ path: file });
    return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
  };

  test('reads what was changed, created or deleted, and the rest as it is', async () => {
    const files = withChanges({
      files: await open(),
      changes: [
        { path: 'code/one.js', action: 'update', content: 'edited' },
        { path: 'code/two.js', action: 'delete' },
        { path: 'code/new.js', action: 'create', content: 'new' },
      ],
    });

    expect(await text(files, 'code/one.js')).toBe('edited');
    expect(await text(files, 'code/two.js')).toBeUndefined();
    expect(await text(files, 'code/new.js')).toBe('new');
    expect(await text(files, 'README.md')).toBe('r');
    expect(await files.list({ dir: 'code' })).toEqual(['code/new.js', 'code/one.js']);
    expect(await files.list({ dir: '' })).toEqual(['README.md', 'code/new.js', 'code/one.js']);
  });

  test('only the module asked for gets the changes', async () => {
    const two = createMemoryPackageSource({
 packages: {
      'm:a': { '1.0.0': { 'x.js': 'a' } },
      'm:b': { '1.0.0': { 'x.js': 'b' } },
    } 
});
    const source = sourceWithChanges({ source: two, location: 'm:a', changes: [{ path: 'x.js', action: 'update', content: 'edited' }] });

    expect(await text(await source.open({ location: 'm:a', version: '1.0.0' }), 'x.js')).toBe('edited');
    expect(await text(await source.open({ location: 'm:b', version: '1.0.0' }), 'x.js')).toBe('b');
  });

  test('the modules it needs get their own changes, and its own win over theirs', async () => {
    const two = createMemoryPackageSource({
 packages: {
      'm:a': { '1.0.0': { 'x.js': 'a' } },
      'm:b': { '1.0.0': { 'x.js': 'b' } },
    } 
});
    const source = sourceWithChanges({
      source: two,
      location: 'm:a',
      changes: [],
      others: [{ location: 'm:b', changes: [{ path: 'x.js', action: 'update', content: 'b edited' }] }, { location: 'm:a', changes: [{ path: 'x.js', action: 'delete' }] }],
    });

    expect(await text(await source.open({ location: 'm:a', version: '1.0.0' }), 'x.js')).toBe('a');
    expect(await text(await source.open({ location: 'm:b', version: '1.0.0' }), 'x.js')).toBe('b edited');
  });
});

describe('a fragment whose main file is in a module not required', () => {
  const packages = {
    'm:frag': { '1.0.0': { 'code/Menu.cip.vue': '/*→ items ←*/\n<li>frag</li>\n/*→ items ←*/\n' } },
    'm:gui': { '2.0.0': { 'code/Menu.cipmain.vue': '<ul>\n/*→ items ←*/\n</ul>\n' } },
    'm:other': { '1.0.0': { 'code/Else.vue': 'x' } },
    'm:map': { '1.0.0': { 'code/Map.cipmain.vue': '<map>\n/*→ layers ←*/\n</map>\n', 'code/Menu.cip.vue': '/*→ items ←*/\n<li>map</li>\n/*→ items ←*/\n' } },
  };
  const opened = async (source, location, version) => ({ location, version, files: await source.open({ location, version }) });

  test('finds it in another module of the registry, marked outside', async () => {
    const source = createMemoryPackageSource({ packages });
    const modules = [await opened(source, 'm:frag', '1.0.0')];
    const cips = await describeCips({ modules });

    const found = await withMainsElsewhere({ cips, source, modules, elsewhere: [{ location: 'm:other', version: '1.0.0' }, { location: 'm:gui', version: '2.0.0' }] });
    const [composition] = found.compositions;

    expect(cips.compositions[0].main).toBeUndefined();
    expect(composition.main).toMatchObject({ from: 'm:gui', path: 'code/Menu.cipmain.vue', outside: true });
    expect(composition.spliced).toContain('<li>frag</li>');
    expect(composition.unfilled).toEqual([]);
  });

  test('each gets the main file of the module that has it, and what other modules of the registry add joins it marked outside', async () => {
    const source = createMemoryPackageSource({
 packages: {
      ...packages,
      'm:frag': { '1.0.0': { ...packages['m:frag']['1.0.0'], 'code/Map.cip.vue': '/*→ layers ←*/\nL\n/*→ layers ←*/\n' } },
    } 
});
    const modules = [await opened(source, 'm:frag', '1.0.0')];
    const cips = await describeCips({ modules });

    const found = await withMainsElsewhere({ cips, source, modules, elsewhere: [{ location: 'm:map', version: '1.0.0' }, { location: 'm:gui', version: '2.0.0' }] });
    const menu = found.compositions.find((c) => c.target === 'code/Menu.vue');
    const map = found.compositions.find((c) => c.target === 'code/Map.vue');

    expect(menu.main.from).toBe('m:gui');
    expect(menu.fragments.map((f) => [f.from, Boolean(f.outside)])).toEqual([['m:frag', false], ['m:map', true]]);
    expect(menu.spliced).toContain('<li>frag</li>');
    expect(menu.spliced).toContain('<li>map</li>');
    expect(menu.points.find((p) => p.name === 'items')).toMatchObject({ providers: ['m:frag'], elsewhere: ['m:map'] });
    expect(map.main).toMatchObject({ from: 'm:map', outside: true });
    expect(map.fragments.map((f) => f.from)).toEqual(['m:frag']);
  });

  test('a marker that another module of the registry fills is not unfilled, and says who fills it', async () => {
    const source = createMemoryPackageSource({
 packages: {
      ...packages,
      'm:gui': { '2.0.0': { 'code/Menu.cipmain.vue': '<ul>\n/*→ items ←*/\n/*→ users ←*/\n/*→ nobody ←*/\n</ul>\n' } },
      'm:users': { '1.0.0': { 'code/Menu.cip.vue': '/*→ users ←*/\n<li>users</li>\n/*→ users ←*/\n' } },
    } 
});
    const modules = [await opened(source, 'm:frag', '1.0.0')];
    const cips = await describeCips({ modules });

    const found = await withMainsElsewhere({ cips, source, modules, elsewhere: [{ location: 'm:gui', version: '2.0.0' }, { location: 'm:users', version: '1.0.0' }] });
    const [composition] = found.compositions;

    expect(composition.unfilled).toEqual(['nobody']);
    expect(composition.points.find((p) => p.name === 'users')).toMatchObject({ providers: [], elsewhere: ['m:users'] });
    expect(composition.points.find((p) => p.name === 'items').providers).toEqual(['m:frag']);
  });

  test('leaves it without a main file when no module has it', async () => {
    const source = createMemoryPackageSource({ packages });
    const modules = [await opened(source, 'm:frag', '1.0.0')];
    const cips = await describeCips({ modules });

    const found = await withMainsElsewhere({ cips, source, modules, elsewhere: [{ location: 'm:other', version: '1.0.0' }, { location: 'm:gone', version: '1.0.0' }] });

    expect(found.compositions[0].main).toBeUndefined();
  });
});

describe('a module that cannot be resolved', () => {
  test('says why, instead of failing', async () => {
    const source = createMemoryPackageSource({ packages: {} });

    const described = await describeModuleTrial({ source, location: 'm:gone', version: '1.0.0' });
    const derived = await deriveModuleTrial({ source, location: 'm:gone', version: '1.0.0' });
    const checked = await checkModuleTrial({ source, location: 'm:gone', version: '1.0.0' });

    expect(described).toMatchObject({ ok: false, metamodels: [], cips: { compositions: [] } });
    expect(described.error).toBeTruthy();
    expect(derived.ok).toBe(false);
    expect(checked.ok).toBe(false);
  });
});

describe.skipIf(!hasPackages)('a real module', () => {
  const source = () => createFsPackageSource({ root: linea });
  const version = async () => (await source().listVersions({ location: LOCATION }))[0];

  test('brings what it needs: metamodels with their smallest model, features and code insertion points', async () => {
    const trial = await describeModuleTrial({ source: source(), location: LOCATION, version: await version() });

    expect(trial.ok).toBe(true);
    expect(trial.modules.map((m) => m.location)).toContain('file:modules/main-component');
    expect(trial.modules.find((m) => m.location === 'file:modules/main-component').requiredBy).toEqual([LOCATION]);
    expect(trial.modules.find((m) => m.location === LOCATION).requiredBy).toEqual([]);
    expect(trial.metamodels.map((m) => m.name)).toEqual(expect.arrayContaining(['basic', 'datamodel', 'featureselection']));
    expect(trial.features[0]).toMatchObject({ name: 'Trial', depth: 0 });
    expect(trial.featureModel.root.name).toBe('Trial');
    expect(trial.featureModel.root.groups.length).toBeGreaterThan(0);
    expect(Array.isArray(trial.featureModel.constraints)).toBe(true);
    expect(trial.selected).toContain('WebApplication');
    expect(Object.keys(trial.bundle.grammars)).toEqual(expect.arrayContaining(['basic', 'datamodel']));
    const filled = trial.cips.compositions.find((c) => c.main && c.fragments.some((f) => f.from === LOCATION));
    expect(filled.main.from).toBe('file:modules/main-component');
    expect(filled.spliced).toBeTruthy();
    expect(trial.cips.compositions.some((c) => !c.main)).toBe(true);
  });

  test('derives with changes not committed, and the product shows them', async () => {
    const before = await deriveModuleTrial({ source: source(), location: LOCATION, version: await version(), contents: true });
    const changed = sourceWithChanges({ source: source(), location: LOCATION, changes: [{ path: 'code/trial-note.txt', action: 'create', content: 'hello from an edit\n' }] });
    const after = await deriveModuleTrial({ source: changed, location: LOCATION, version: await version(), contents: true });

    expect(before.ok).toBe(true);
    expect(before.files).not.toContain('trial-note.txt');
    expect(after.ok).toBe(true);
    expect(after.contents['trial-note.txt']).toBe('hello from an edit\n');
  });

  test('a change in a fragment comes out in the file its code insertion point makes', async () => {
    const trial = await describeModuleTrial({ source: source(), location: LOCATION, version: await version() });
    const composition = trial.cips.compositions.find((c) => c.main && c.fragments.some((f) => f.from === LOCATION && f.path.startsWith('code/') && f.points.length));
    const fragment = composition.fragments.find((f) => f.from === LOCATION);
    const [point] = fragment.points;
    const marker = `/*→ ${point} ←*/`;
    const content = `${marker}\nMARK_FROM_THE_TRIAL\n${marker}\n`;
    const changed = sourceWithChanges({ source: source(), location: LOCATION, changes: [{ path: fragment.path, action: 'update', content }] });

    const described = await describeModuleTrial({ source: changed, location: LOCATION, version: await version() });

    expect(described.cips.compositions.find((c) => c.target === composition.target).spliced).toContain('MARK_FROM_THE_TRIAL');
  });

  test('an instance that is wrong is told, with no product made', async () => {
    const derived = await deriveModuleTrial({ source: source(), location: LOCATION, version: await version(), models: { datamodel: 'this is not a datamodel {{{' } });

    expect(derived.ok).toBe(false);
    expect(derived.diagnostics.some((d) => d.severity === 'error' && /datamodel/.test(`${d.file} ${d.message}`))).toBe(true);
    expect(derived.files).toBeUndefined();
  });

  test('checks the models against their grammars, telling where each problem is', async () => {
    const good = await checkModuleTrial({ source: source(), location: LOCATION, version: await version() });
    const bad = await checkModuleTrial({ source: source(), location: LOCATION, version: await version(), models: { datamodel: 'this is not a datamodel {{{' } });

    expect(good).toMatchObject({ ok: true });
    expect(good.context.transformation).toContain('module.exports');
    expect(typeof good.context.extraJs).toBe('string');
    expect(good.context.spec.features).toEqual(expect.arrayContaining(['WebApplication']));
    expect(good.context.spec.models).toBeTruthy();
    expect(bad.context).toBeUndefined();
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.some((d) => d.severity === 'error' && d.file === '.linea/models/datamodel.datamodel' && /^\d+:\d+ /.test(d.message))).toBe(true);
  });

  test('the features chosen decide the product, and a selection that does not fit is told', async () => {
    const { selected } = await describeModuleTrial({ source: source(), location: LOCATION, version: await version() });

    const chosen = await deriveModuleTrial({ source: source(), location: LOCATION, version: await version(), features: selected });
    const broken = await deriveModuleTrial({ source: source(), location: LOCATION, version: await version(), features: ['WebApplication'] });

    expect(chosen.ok).toBe(true);
    expect(chosen.files.length).toBeGreaterThan(0);
    expect(broken.ok).toBe(false);
    expect(broken.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  test('features of modules that are not in the trial are left out instead of failing', async () => {
    const { selected } = await describeModuleTrial({ source: source(), location: LOCATION, version: await version() });

    const derived = await deriveModuleTrial({ source: source(), location: LOCATION, version: await version(), features: [...selected, 'UserManagement', 'UM_Authentication'] });

    expect(derived.ok).toBe(true);
  });
});
