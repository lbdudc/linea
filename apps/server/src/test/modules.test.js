import bcrypt from 'bcrypt';
import { test, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { Container } from 'typedi';
import User from '../model/entities/user.js';
import LineService from '../model/services/LineService.js';
import ProductService from '../model/services/ProductService.js';
import ModularService from '../model/services/modules/ModularService.js';
import PackageService from '../model/services/modules/PackageService.js';
import { usageOf } from '../model/services/modules/packageUsage.js';
import RegistryService from '../model/services/modules/RegistryService.js';
import { LineModularReadOnlyError, LineNotModularError, PackageNotFoundError, PackageVersionExistsError, RegistryNotConfiguredError } from '../model/errors/errors.js';
import { setup, clear, teardown } from '../test/setup.js';
import { setupGitlabDouble, resetGitlabDouble, teardownGitlabDouble, gitlabDouble } from '../test/support/withGitlabDouble.js';
import { upsertFiles } from '../model/services/modules/hosts.js';
import { featureMetamodelVersion } from '../test/support/featureMetamodel.js';
import { hostOf } from '../model/git/hosts.js';

// each test publishes packages and runs metamodel engines: slower than the default 5s when the whole suite runs in parallel
vi.setConfig({ testTimeout: 90_000 });

const lineService = Container.get(LineService);
const productService = Container.get(ProductService);
const packageService = new PackageService();
const modularService = Container.get(ModularService);
const registryService = new RegistryService();

const BASIC_GRAMMAR = `grammar Basic

// Basic: the name of the product
entry BasicModel: 'basic' name=ID;

terminal ID: /[_a-zA-Z][\\w_-]*/;
hidden terminal WS: /\\s+/;
`;

const DATAMODEL_GRAMMAR = `grammar Datamodel

// Data model: entities, with fields that may point at other entities
entry Model: 'datamodel' name=ID? (entities+=Entity)*;

Entity: 'entity' name=ID '{' (fields+=Field)* '}';

Field: 'field' name=ID ('->' target=[Entity:ID])?;

terminal ID: /[_a-zA-Z][\\w_-]*/;
hidden terminal WS: /\\s+/;
`;

const OFFERED = 'datamodel um\n\nentity UM_User {\n  field login\n}\n';

const TRANSFORMATION = 'registerMetamodelProcessor(function (ret, input) {\n  ret.data.models = input.modelsByMetamodel;\n});\n';
const USERS_JS = '/*% if (feature.Profile) { %*/\nexport const profile = true;\n/*% } %*/\nexport const models = /*%= JSON.stringify(data.models) %*/;\n';

beforeAll(setup);
beforeAll(setupGitlabDouble);
afterEach(clear);
afterEach(resetGitlabDouble);
afterAll(teardown);
afterAll(teardownGitlabDouble);

const admin = async () => new User({
  username: `modules-${Date.now()}-${Math.random()}`,
  password: await bcrypt.hash('password', 10),
  admin: true,
}).save();

const write = (userId, kind, id, files) =>
  Promise.all(Object.entries(files).map(([path, content]) => packageService.saveFile({ userId, kind, id, path, content })));

// a metamodel can bring views of its own: page code, which the browser runs and the server only carries
const VIEWS = "return [{ id: 'x', label: 'X', create: () => ({ mount() {}, update() {}, dispose() {} }) }];";

const publishMetamodel = async ({ userId, namespaceId, name, grammar, files = {} }) => {
  const pkg = await packageService.create({ userId, kind: 'metamodel', name, description: `${name} metamodel`, namespaceId });
  await write(userId, 'metamodel', pkg.id, { [`grammars/${name}.langium`]: grammar, ...files });
  await packageService.publish({ userId, kind: 'metamodel', id: pkg.id });
  return pkg;
};

/** A registry with two metamodels and a module that uses both and offers a model, all published. */
const seedRegistry = async (userId) => {
  const group = gitlabDouble().state.createGroup({ name: 'registry' });
  const basic = await publishMetamodel({ userId, namespaceId: group.id, name: 'basic', grammar: BASIC_GRAMMAR });
  const datamodel = await publishMetamodel({ userId, namespaceId: group.id, name: 'datamodel', grammar: DATAMODEL_GRAMMAR, files: { 'visualizations/datamodel.js': VIEWS } });

  const um = await packageService.create({ userId, kind: 'module', name: 'user-management', description: 'users', namespaceId: group.id });
  await write(userId, 'module', um.id, {
    '.linea/module.json': JSON.stringify({
      name: 'user-management',
      version: '0.1.0',
      requires: { modules: {}, metamodels: { [basic.location]: '^0.1.0', [datamodel.location]: '^0.1.0' } },
      offers: { datamodel: 'models/datamodel.instance' },
    }),
    '.linea/model.uvl': 'features\n\tUserManagement\n\t\toptional\n\t\t\tProfile\n',
    'models/datamodel.instance': OFFERED,
    '.linea/config/transformation.js': TRANSFORMATION,
    'code/server/users.js': USERS_JS,
  });
  await packageService.publish({ userId, kind: 'module', id: um.id });
  return { group, basic, datamodel, um };
};

test('packages: created from a scaffold, listed, checked and published as tags', async () => {
  const user = await admin();
  const group = gitlabDouble().state.createGroup({ name: 'registry' });

  const created = await packageService.create({ userId: user._id, kind: 'metamodel', name: 'sensors', description: 'Sensors', namespaceId: group.id });
  expect(created).toMatchObject({ kind: 'metamodel', name: 'sensors', location: 'gitlab:registry/sensors', versions: [] });

  // the scaffold is a valid metamodel as it is
  const check = await packageService.check({ userId: user._id, kind: 'metamodel', id: created.id });
  expect(check.diagnostics).toEqual([]);
  expect(check.ok).toBe(true);
  expect(check.metamodels.map((m) => m.name)).toEqual(['sensors']);

  const published = await packageService.publish({ userId: user._id, kind: 'metamodel', id: created.id });
  expect(published).toMatchObject({ version: '0.1.0', tag: 'v0.1.0' });

  // a version is published once
  await expect(packageService.publish({ userId: user._id, kind: 'metamodel', id: created.id })).rejects.toBeInstanceOf(PackageVersionExistsError);
  // ...unless the version is raised
  const bumped = await packageService.publish({ userId: user._id, kind: 'metamodel', id: created.id, bump: 'minor' });
  expect(bumped.version).toBe('0.2.0');

  const listed = await packageService.list({ userId: user._id, kind: 'metamodel' });
  // (the feature metamodel every SPL has is published in the double too)
  expect(listed.map((p) => p.name)).toEqual(['common', 'featuremodel', 'sensors']);
  expect(listed.find((p) => p.name === 'sensors')).toMatchObject({ versions: ['0.2.0', '0.1.0'], latest: '0.2.0' });
  expect(await packageService.list({ userId: user._id, kind: 'module' })).toEqual([]);

  const detail = await packageService.get({ userId: user._id, kind: 'metamodel', id: created.id });
  expect(detail.files).toEqual(['README.md', 'grammars/sensors.langium', 'metamodel.json']);
  expect(detail.manifest).toMatchObject({ name: 'sensors', version: '0.2.0' });
  const file = await packageService.readFile({ userId: user._id, kind: 'metamodel', id: created.id, path: 'grammars/sensors.langium' });
  expect(file.content).toContain('grammar Sensors');
});

test('packages: a broken package is reported and cannot be published', async () => {
  const user = await admin();
  const group = gitlabDouble().state.createGroup({ name: 'registry' });
  const mm = await packageService.create({ userId: user._id, kind: 'metamodel', name: 'broken', namespaceId: group.id });
  await packageService.saveFile({ userId: user._id, kind: 'metamodel', id: mm.id, path: 'grammars/broken.langium', content: 'grammar Broken\nentry X: ;;;\n' });

  const check = await packageService.check({ userId: user._id, kind: 'metamodel', id: mm.id });
  expect(check.ok).toBe(false);
  expect(check.diagnostics.find((d) => d.file === 'grammars/broken.langium')).toBeTruthy();
  await expect(packageService.publish({ userId: user._id, kind: 'metamodel', id: mm.id })).rejects.toMatchObject({ code: 'MODULE_CHECK_FAILED' });

  // a manifest that is not valid is not saved
  await expect(packageService.saveFile({ userId: user._id, kind: 'metamodel', id: mm.id, path: 'metamodel.json', content: '{"name":' }))
    .rejects.toMatchObject({ code: 'MODULE_MANIFEST_INVALID' });
  // and a path outside the package is refused
  await expect(packageService.saveFile({ userId: user._id, kind: 'metamodel', id: mm.id, path: '../x', content: 'x' })).rejects.toBeInstanceOf(PackageNotFoundError);
});

test('a module that needs a metamodel nobody published cannot be published', async () => {
  const user = await admin();
  const group = gitlabDouble().state.createGroup({ name: 'registry' });
  const mod = await packageService.create({ userId: user._id, kind: 'module', name: 'lonely', namespaceId: group.id });
  await write(user._id, 'module', mod.id, {
    '.linea/module.json': JSON.stringify({ name: 'lonely', version: '0.1.0', requires: { metamodels: { 'gitlab:registry/nothing': '^1.0.0' } } }),
  });
  const check = await packageService.check({ userId: user._id, kind: 'module', id: mod.id });
  expect(check.ok).toBe(false);
  expect(check.diagnostics[0].message).toMatch(/gitlab:registry\/nothing.*(does not exist|no access)/);
});

test('a modular line, its product and its models, from the registry to a generated product', async () => {
  const user = await admin();
  const { um } = await seedRegistry(user._id);

  // the line starts with no modules, and its feature model is just a root
  const line = await lineService.createLine({ userId: user._id, name: 'GisApps', version: '1.0.0', description: 'x', kind: 'modular' });
  expect(line.modular).toBe(true);
  expect((await modularService.getLineModules({ id: line._id, userId: user._id })).spl.modules).toEqual({});

  // choosing modules resolves everything they need, checks it, and commits spl.json and the lockfile
  const saved = await modularService.saveLineModules({ id: line._id, userId: user._id, modules: { [um.location]: '^0.1.0' } });
  // (the feature metamodel, and the library it imports, are in every SPL)
  expect(saved.packages.map((p) => `${p.kind}:${p.name}@${p.version}`).sort()).toEqual([
    'metamodel:basic@0.1.0', 'metamodel:common@1.1.0', 'metamodel:datamodel@0.1.0', `metamodel:featuremodel@${featureMetamodelVersion()}`, 'module:user-management@0.1.0',
  ]);
  const repo = gitlabDouble().getProject(line.repoId).treeAt('main');
  expect(JSON.parse(repo.get('linea.lock.json').toString()).packages[um.location]).toMatchObject({ kind: 'module', version: '0.1.0' });

  const modules = await modularService.getLineModules({ id: line._id, userId: user._id });
  expect(modules).toMatchObject({ modular: true, lockCurrent: true });
  expect(modules.featureModel).toContain('Profile');

  // the feature model of the line is the composed one, and is read-only
  const fm = await lineService.getFeatureModel({ id: line._id, userId: user._id });
  expect(fm).toMatchObject({ modular: true, readOnly: true, metamodel: 'featuremodel' });
  expect(fm.uvl).toContain('UserManagement');
  expect(fm.text).toContain('UserManagement');
  await expect(lineService.saveFeatureModel({ id: line._id, userId: user._id, content: 'featuremodel X feature X' })).rejects.toBeInstanceOf(LineModularReadOnlyError);

  // modules that do not fit are not saved
  await expect(modularService.saveLineModules({ id: line._id, userId: user._id, modules: { 'gitlab:registry/nothing': '*' } }))
    .rejects.toMatchObject({ code: 'MODULE_RESOLUTION_FAILED' });

  // a product starts with the smallest valid model of each metamodel, and its feature selection is the one it was made with
  const product = await productService.createProduct({
    userId: user._id,
    lineId: line._id,
    spec: { basicData: { name: 'Shop', version: '0.0.0', database: {}, languages: ['en'] }, dataModel: { cells: [] }, features: ['GisApps', 'Profile'], statics: [] },
  });
  const productRepo = () => gitlabDouble().getProject(product.repo.id);
  expect([...productRepo().treeAt('main').keys()].filter((p) => p.startsWith('.linea/models/')).sort()).toEqual(['.linea/models/basic.basic', '.linea/models/datamodel.datamodel', '.linea/models/featureselection.featureselection']);

  const overview = await modularService.getProductModels({ id: product._id, userId: user._id });
  expect(overview.metamodels.map((m) => m.name).sort()).toEqual(['basic', 'datamodel', 'featureselection']);
  // its feature selection is checked against the feature model of the SPL, which is offered to it (read-only)
  expect(overview.configuration).toEqual([expect.objectContaining({ metamodel: 'featuremodel', level: 1 })]);
  expect(overview.metamodels.find((m) => m.name === 'featureselection').model).toContain('select Profile');
  expect(overview.metamodels.every((m) => typeof m.model === 'string')).toBe(true);
  expect(overview.offered).toContainEqual(expect.objectContaining({ origin: 'user-management', metamodel: 'datamodel', text: OFFERED }));
  // the views a metamodel brings reach the browser with its grammar; nothing has been moved on a diagram yet
  expect(overview.bundle.visualizations).toMatchObject({ datamodel: VIEWS });
  expect(overview.layouts).toEqual({});

  // editing a model: it may refer to what a module offers (read-only), and is reported when it does not fit
  const good = await modularService.saveProductModel({
    id: product._id, userId: user._id, metamodel: 'datamodel',
    content: 'datamodel shop\n\nentity Order {\n  field owner -> UM_User\n}\n',
  });
  expect(good.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

  // where the nodes of a diagram were left is saved with the model, as data: what is not a position of a node of one of its metamodels is dropped
  await modularService.saveProductModel({
    id: product._id, userId: user._id, metamodel: 'datamodel',
    content: 'datamodel shop\n\nentity Order {\n  field owner -> UM_User\n}\n',
    layouts: {
      datamodel: { 'viz:class-diagram': { Order: { x: 10.4, y: 20 }, Bad: { x: 'far' }, Worse: 3 }, empty: {}, notAView: 7 },
      nonsense: { 'viz:x': { A: { x: 1, y: 1 } } },
    },
  });
  const layoutsFile = JSON.parse(productRepo().treeAt('main').get('.linea/layouts.json').toString());
  expect(layoutsFile).toEqual({ datamodel: { 'viz:class-diagram': { Order: { x: 10, y: 20 } } } });
  expect((await modularService.getProductModels({ id: product._id, userId: user._id })).layouts).toEqual(layoutsFile);
  // the layout file is not a model: the models are still the same two
  expect([...productRepo().treeAt('main').keys()].filter((p) => p.startsWith('.linea/models/')).sort()).toEqual(['.linea/models/basic.basic', '.linea/models/datamodel.datamodel', '.linea/models/featureselection.featureselection']);
  await modularService.saveProductLayouts({ id: product._id, userId: user._id, layouts: { datamodel: { 'viz:class-diagram': { Order: { x: 0, y: 0 } } } } });
  expect((await modularService.getProductModels({ id: product._id, userId: user._id })).layouts).toEqual({ datamodel: { 'viz:class-diagram': { Order: { x: 0, y: 0 } } } });
  const bad = await modularService.checkProductModels({ id: product._id, userId: user._id, models: { datamodel: 'datamodel shop\n\nentity Order {\n  field owner -> Nobody\n}\n' } });
  expect(bad.ok).toBe(false);
  expect(bad.diagnostics).toContainEqual(expect.objectContaining({ file: '.linea/models/datamodel.datamodel', message: expect.stringMatching(/Nobody/) }));
  const redeclared = await modularService.checkProductModels({ id: product._id, userId: user._id, models: { datamodel: 'datamodel shop\n\nentity UM_User {\n}\n' } });
  expect(redeclared.diagnostics.map((d) => d.message).join('\n')).toMatch(/already declared by 'user-management' \(read-only\)/);
  await expect(modularService.saveProductModel({ id: product._id, userId: user._id, metamodel: 'zzz', content: 'x' })).rejects.toBeInstanceOf(PackageNotFoundError);

  // generating derives the product from the composed platform, with its models
  const log = [];
  await productService.generateProduct({ id: product._id, userId: user._id }, async (event) => { log.push(event); });
  expect(log.filter((event) => event.type === 'error')).toEqual([]);
  const users = productRepo().treeAt('main').get('server/users.js').toString();
  expect(users).toContain('export const profile = true;');
  expect(users).toContain('Order');
  expect(users).toContain('UM_User');

  // generating merges into main: what the product had there (its models) stays, and the metamodels reach the client as GitLab has them
  const after = await modularService.getProductModels({ id: product._id, userId: user._id });
  expect(after.metamodels.find((m) => m.name === 'datamodel').model).toContain('UM_User');
  expect(Object.keys(after.bundle.grammars).sort()).toEqual(expect.arrayContaining(['basic', 'datamodel', 'featuremodel', 'featureselection']));
  expect(after.bundle.grammars.datamodel).toContain('grammar Datamodel');

  // the product page configures a product against the feature model its modules compose, and finds its selection valid
  const health = await productService.getProductHealth({ id: product._id, userId: user._id });
  expect(health).toMatchObject({ valid: true, error: null });
  expect(health.features).toEqual(expect.arrayContaining(['GisApps', 'Profile']));
});

test('a line is tried with models of its own, validated against its metamodels, without making a product', async () => {
  const user = await admin();
  const { um } = await seedRegistry(user._id);
  const line = await lineService.createLine({ userId: user._id, name: 'TrialApps', version: '1.0.0', description: 'x', kind: 'modular' });
  await modularService.saveLineModules({ id: line._id, userId: user._id, modules: { [um.location]: '^0.1.0' } });

  const trial = await modularService.trialModels({ id: line._id, userId: user._id });
  expect(trial.metamodels.map((m) => `${m.name}.${m.extension}`).sort()).toEqual(['basic.basic', 'datamodel.datamodel', 'featureselection.featureselection']);
  expect(trial.featureModel).toBe('TrialApps');
  expect(Object.keys(trial.models).sort()).toEqual(['basic', 'datamodel', 'featureselection']);
  expect(trial.bundle.grammars.datamodel).toContain('grammar Datamodel');
  expect(trial.bundle.visualizations).toMatchObject({ datamodel: VIEWS });
  expect(trial.offered).toContainEqual(expect.objectContaining({ origin: 'user-management', metamodel: 'datamodel', text: OFFERED }));
  expect(trial.configuration).toEqual([expect.objectContaining({ metamodel: 'featuremodel', level: 1 })]);

  const order = 'datamodel shop\n\nentity Order {\n  field owner -> UM_User\n}\n';
  const good = await modularService.checkTrialModels({ id: line._id, userId: user._id, models: { datamodel: order }, features: ['TrialApps', 'Profile'] });
  expect(good.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(good.ok).toBe(true);
  expect(good.features).toEqual(expect.arrayContaining(['TrialApps', 'Profile']));
  expect(JSON.stringify(good.modelsByMetamodel.datamodel)).toContain('Order');
  const sampled = await modularService.checkTrialModels({ id: line._id, userId: user._id, models: { datamodel: order }, features: ['TrialApps'], spec: { basicData: { name: 'demo' } } });
  expect(sampled.trialSpec).toMatchObject({ basicData: { name: 'demo', version: '0.0.0' }, dataModel: { cells: [] }, statics: [] });
  expect(JSON.stringify(sampled.trialSpec.modelsByMetamodel.datamodel)).toContain('Order');

  const bad = await modularService.checkTrialModels({ id: line._id, userId: user._id, models: { datamodel: order.replace('UM_User', 'Nobody') } });
  expect(bad.ok).toBe(false);
  expect(bad.diagnostics).toContainEqual(expect.objectContaining({ file: '.linea/models/datamodel.datamodel', message: expect.stringMatching(/Nobody/) }));
  expect(bad.spec).toBeNull();

  const stray = await modularService.checkTrialModels({ id: line._id, userId: user._id, models: { gone: 'x' } });
  expect(stray.ok).toBe(true);
  expect(stray.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/"gone"/) }));

  const broken = await modularService.checkTrialModels({ id: line._id, userId: user._id, overrides: [{ path: 'spl.json', action: 'update', content: '{"name":' }] });
  expect(broken.ok).toBe(false);

  const derived = await productService.tryDerivation({ lineId: line._id, userId: user._id, features: ['TrialApps', 'Profile'], models: { datamodel: order }, include: ['server/users.js'] });
  expect(derived.ok).toBe(true);
  expect(derived.contents['server/users.js']).toContain('Order');
  expect(derived.contents['server/users.js']).toContain('export const profile = true;');

  const refused = await productService.tryDerivation({ lineId: line._id, userId: user._id, features: ['TrialApps'], models: { datamodel: order.replace('UM_User', 'Nobody') } });
  expect(refused.ok).toBe(false);
  expect(refused.diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/Nobody/) }));
});

const BASIC_IMPORT = "const importer = function (json, { n }) { return n('BasicModel', { name: json.data.basicData.name }); };\nreturn importer;\n";
const DATAMODEL_IMPORT = "const importer = function (json, { n }) { return n('Model', { name: 'imported', entities: (json.data.dataModel?.entities ?? []).map((e) => n('Entity', { name: e.name, fields: (e.fields ?? []).map((f) => n('Field', { name: f })) })) }); };\nreturn importer;\n";
const TABLES_TRANSFORMATION = 'module.exports = function (input) {\n  return { features: input.features, data: { basicData: input.basicData, dataModel: { entities: (input.tables || []).map(function (t) { return { name: t.name, fields: t.columns || [] }; }) } } };\n};\n';

test('importing a spec in a product of a project fills its models: through the transformation of the line, only with what validates and only what it has', async () => {
  const user = await admin();
  const group = gitlabDouble().state.createGroup({ name: 'registry' });
  const basic = await publishMetamodel({ userId: user._id, namespaceId: group.id, name: 'basic', grammar: BASIC_GRAMMAR, files: { 'imports/basic.js': BASIC_IMPORT } });
  const datamodel = await publishMetamodel({ userId: user._id, namespaceId: group.id, name: 'datamodel', grammar: DATAMODEL_GRAMMAR, files: { 'imports/datamodel.js': DATAMODEL_IMPORT } });
  const line = await lineService.createLine({ userId: user._id, name: 'Shops', version: '1.0.0', description: 'x', kind: 'project', metamodels: { [basic.location]: '^0.1.0', [datamodel.location]: '^0.1.0' } });
  expect(line.kind).toBe('project');
  expect(line.modular).toBe(false);
  await upsertFiles({ token: 'test', host: hostOf(line), id: line.repoId, branch: 'main', message: 'A transformation of its own', files: { 'src/platform/transformation.js': TABLES_TRANSFORMATION } });

  const product = await productService.createProduct({
    userId: user._id,
    lineId: line._id,
    spec: { basicData: { name: 'Shop', version: '0.0.0', database: {}, languages: ['en'] }, dataModel: { cells: [] }, features: ['Shops'], statics: [] },
  });
  const modelOf = (name) => gitlabDouble().getProject(product.repo.id).treeAt('main').get(`.linea/models/${name}.${name}`).toString();

  const saved = await productService.updateProduct({
    id: product._id,
    userId: user._id,
    spec: { basicData: { name: 'Shop', version: '0.0.0', database: {}, languages: ['en'] }, features: ['Shops'], statics: [] },
    importedSpec: { basicData: { name: 'Tienda', version: '0.0.0', database: {}, languages: ['en'] }, tables: [{ name: 'Order', columns: ['total'] }, { name: 'Customer' }], features: ['Shops'], statics: [] },
  });
  const report = saved.$locals.modelImport;
  expect(report).toMatchObject({ transformed: true, invalid: [], errors: [], after: { ok: true, errors: 0 } });
  expect(report.updated.sort()).toEqual(['basic', 'datamodel']);
  expect(modelOf('basic')).toMatch(/basic\s+Tienda/);
  expect(modelOf('datamodel')).toContain('entity Order');
  expect(modelOf('datamodel')).toContain('field total');
  expect(modelOf('datamodel')).toContain('entity Customer');
  expect(modelOf('featureselection')).toContain('Shops');

  const rejected = await productService.updateProduct({
    id: product._id,
    userId: user._id,
    spec: { basicData: { name: 'Shop', version: '0.0.0', database: {}, languages: ['en'] }, features: ['Shops'], statics: [] },
    importedSpec: { basicData: { name: 'Otra', version: '0.0.0', database: {}, languages: ['en'] }, tables: [{ name: '9lives' }], features: ['Shops'], statics: [] },
  });
  const second = rejected.$locals.modelImport;
  expect(second.updated).toEqual(['basic']);
  expect(second.invalid).toEqual([expect.objectContaining({ metamodel: 'datamodel', count: expect.any(Number) })]);
  expect(modelOf('basic')).toMatch(/basic\s+Otra/);
  expect(modelOf('datamodel')).toContain('entity Order');

  const processed = await productService.updateProduct({
    id: product._id,
    userId: user._id,
    spec: { basicData: { name: 'Shop', version: '0.0.0', database: {}, languages: ['en'] }, features: ['Shops'], statics: [] },
    importedSpec: { basicData: { name: 'Tienda', version: '0.0.0', database: {}, languages: ['en'] }, dataModel: { entities: [{ name: 'Invoice', fields: ['amount'] }] }, features: ['Shops'], statics: [] },
  });
  expect(processed.$locals.modelImport).toMatchObject({ transformed: false, errors: [] });
  expect(modelOf('datamodel')).toContain('entity Invoice');

  const plain = await productService.updateProduct({
    id: product._id,
    userId: user._id,
    spec: { basicData: { name: 'Renamed', version: '0.0.0', database: {}, languages: ['en'] }, features: ['Shops'], statics: [] },
  });
  expect(plain.$locals.modelImport).toMatchObject({ imported: false, updated: ['basic'] });
  expect(plain.$locals.modelImport.untouched).toContain('datamodel');
  expect(modelOf('basic')).toMatch(/basic\s+Renamed/);
  expect(modelOf('datamodel')).toContain('entity Invoice');
});

test('generation refuses a product whose models do not fit its line', async () => {
  const user = await admin();
  const { um } = await seedRegistry(user._id);
  const line = await lineService.createLine({ userId: user._id, name: 'StrictApps', version: '1.0.0', description: 'x', kind: 'modular' });
  await modularService.saveLineModules({ id: line._id, userId: user._id, modules: { [um.location]: '^0.1.0' } });
  const product = await productService.createProduct({
    userId: user._id,
    lineId: line._id,
    spec: { basicData: { name: 'Broken', version: '0.0.0', database: {}, languages: ['en'] }, dataModel: { cells: [] }, features: ['StrictApps'], statics: [] },
  });
  await modularService.saveProductModel({ id: product._id, userId: user._id, metamodel: 'datamodel', content: 'datamodel x\n\nentity A {\n  field f -> Missing\n}\n' });
  await expect(productService.generateProduct({ id: product._id, userId: user._id }, async () => {})).rejects.toMatchObject({ code: 'MODULE_CHECK_FAILED' });
});

test('a product whose SPL changed its metamodels is brought in line and still generates', async () => {
  const user = await admin();
  const { um } = await seedRegistry(user._id);
  const line = await lineService.createLine({ userId: user._id, name: 'ShiftingApps', version: '1.0.0', description: 'x', kind: 'modular' });
  await modularService.saveLineModules({ id: line._id, userId: user._id, modules: { [um.location]: '^0.1.0' } });
  const product = await productService.createProduct({
    userId: user._id,
    lineId: line._id,
    spec: { basicData: { name: 'Shifty', version: '0.0.0', database: {}, languages: ['en'] }, dataModel: { cells: [] }, features: ['ShiftingApps'], statics: [] },
  });
  const project = gitlabDouble().getProject(product.repo.id);
  const modelFiles = () => [...project.treeAt('main').keys()].filter((p) => p.startsWith('.linea/models/')).sort();
  // the SPL dropped a module (its metamodel is gone from the SPL, its model is still in the product) and gained another (no model yet)
  project.commit({
 branch: 'main', message: 'simulate an SPL change', actions: [
    { action: 'create', file_path: '.linea/models/sensors.sensors', content: 'sensors s\n' },
    { action: 'delete', file_path: '.linea/models/datamodel.datamodel' },
  ] 
});
  const before = await modularService.getProductModels({ id: product._id, userId: user._id, summary: true });
  expect(before.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual(expect.arrayContaining(['"sensors" is not a metamodel of the products of this SPL.']));

  await productService.generateProduct({ id: product._id, userId: user._id }, async () => {});
  expect(modelFiles()).toEqual(['.linea/models/basic.basic', '.linea/models/datamodel.datamodel', '.linea/models/featureselection.featureselection']);
  const after = await modularService.getProductModels({ id: product._id, userId: user._id, summary: true });
  expect(after.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

  // the same by hand, without generating
  project.commit({ branch: 'main', message: 'again', actions: [{ action: 'create', file_path: '.linea/models/zzz.zzz', content: 'x' }] });
  expect(await modularService.syncProductModels({ id: product._id, userId: user._id })).toEqual({ removed: ['zzz'], added: [] });
  expect(modelFiles()).toEqual(['.linea/models/basic.basic', '.linea/models/datamodel.datamodel', '.linea/models/featureselection.featureselection']);
});

test('a plain line is not modular, and has no models to edit', async () => {
  const user = await admin();
  const line = await lineService.createLine({ userId: user._id, name: 'PlainLine', version: '1.0.0', description: 'x' });
  expect(line.kind).toBe('plain');
  const modules = await modularService.getLineModules({ id: line._id, userId: user._id });
  expect(modules).toMatchObject({ modular: false, kind: 'plain', lockCurrent: true });
  // it is made of the feature metamodel, and nothing else
  expect(Object.keys(modules.spl.metamodels)).toEqual(['gitlab:linea/metamodels/featuremodel']);
  expect(modules.spl.modules).toEqual({});
  expect(modules.featureModel).toContain('PlainLine');
  await expect(modularService.saveLineModules({ id: line._id, userId: user._id, modules: {} })).rejects.toBeInstanceOf(LineNotModularError);
});

// a metamodel of level 1 besides the feature metamodel: the SPL has a model of it, and the models of its products are made from it
const SETTINGS_GRAMMAR = `grammar Settings

// @level 1
// Settings: what every product of the SPL is configured with
entry SettingsModel: 'settings' name=ID ('{' (options+=Option)* '}')?;

Option: 'option' name=ID;

terminal ID: /[_a-zA-Z][\\w_-]*/;
hidden terminal WS: /\\s+/;
`;

test('an SPL with a metamodel of level 1 has a model of it, next to its feature model', async () => {
  const user = await admin();
  const group = gitlabDouble().state.createGroup({ name: 'registry' });
  const settings = await publishMetamodel({ userId: user._id, namespaceId: group.id, name: 'settings', grammar: SETTINGS_GRAMMAR });
  const line = await lineService.createLine({ userId: user._id, name: 'Levelled', version: '1.0.0', description: 'x', kind: 'project', metamodels: { [settings.location]: '^0.1.0' } });

  // the SPL page offers the model of each metamodel of a level above 0; the one it has not saved yet starts from the smallest valid one
  const first = await lineService.getFeatureModel({ id: line._id, userId: user._id });
  expect(first.models.map((m) => [m.metamodel, m.level, m.stored]).sort()).toEqual([['featuremodel', 1, true], ['settings', 1, false]]);
  expect(first.models.find((m) => m.metamodel === 'settings').text).toMatch(/^settings/);

  const saved = await lineService.saveFeatureModel({ id: line._id, userId: user._id, metamodel: 'settings', content: 'settings shop {\n  option dark\n}\n' });
  expect(saved.bumped).toBe(true);
  const after = await lineService.getFeatureModel({ id: line._id, userId: user._id });
  expect(after.models.find((m) => m.metamodel === 'settings')).toMatchObject({ stored: true, file: 'models/settings.settings' });
  expect(after.models.find((m) => m.metamodel === 'settings').text).toContain('option dark');
  // a model that does not fit is refused, and a metamodel the SPL does not have is not found
  await expect(lineService.saveFeatureModel({ id: line._id, userId: user._id, metamodel: 'settings', content: 'not settings' })).rejects.toMatchObject({ code: 'MODULE_CHECK_FAILED' });
  await expect(lineService.saveFeatureModel({ id: line._id, userId: user._id, metamodel: 'nothing', content: 'x' })).rejects.toBeInstanceOf(PackageNotFoundError);

  // its products are made from both models: they are offered, and the product has models of the metamodels of level 0 only
  const product = await productService.createProduct({
    userId: user._id, lineId: line._id,
    spec: { basicData: { name: 'LevelledOne', version: '0.0.0', database: {}, languages: ['en'] }, dataModel: { cells: [] }, features: [], statics: [] },
  });
  const overview = await modularService.getProductModels({ id: product._id, userId: user._id });
  expect(overview.metamodels.map((m) => m.name)).toEqual(['featureselection']);
  expect(overview.configuration.map((c) => c.metamodel).sort()).toEqual(['featuremodel', 'settings']);
});

test('where a package is used: the lines that have it, and the pinning of a metamodel of a project', async () => {
  const user = await admin();
  const { um } = await seedRegistry(user._id);
  const modular = await lineService.createLine({ userId: user._id, name: 'UsesUm', version: '1.0.0', description: 'x', kind: 'modular', modules: { [um.location]: '^0.1.0' } });
  const bare = await lineService.createLine({ userId: user._id, name: 'UsesNothing', version: '1.0.0', description: 'x', kind: 'modular' });
  const lines = await lineService.findEnrolledLines({ userId: user._id });
  const pinsOf = (line) => modularService.linePins({ line, userId: user._id });

  const found = await usageOf({ location: um.location, lines, pinsOf });
  expect(found.unreadable).toBe(0);
  expect(found.lines.map((l) => l.name)).toEqual(['UsesUm']);
  expect(found.lines[0]).toMatchObject({ id: String(modular._id), kind: 'modular', direct: true, range: '^0.1.0', version: '0.1.0', products: [] });
  expect(bare.name).toBe('UsesNothing');

  // a package a line has only because another one needs it is listed too, with no range of its own
  const datamodel = await usageOf({ location: 'gitlab:registry/datamodel', lines, pinsOf });
  expect(datamodel.lines).toEqual([expect.objectContaining({ name: 'UsesUm', direct: false, range: null, version: '0.1.0' })]);

  // a metamodel of a project is pinned like a module of a modular line, and what it would be is checked before
  const group = gitlabDouble().state.createGroup({ name: 'registry' });
  const settings = await publishMetamodel({ userId: user._id, namespaceId: group.id, name: 'settings', grammar: SETTINGS_GRAMMAR });
  const project = await lineService.createLine({ userId: user._id, name: 'Pinned', version: '1.0.0', description: 'x', kind: 'project', metamodels: { [settings.location]: '^0.1.0' } });
  const check = await modularService.checkLineModules({ id: project._id, userId: user._id, metamodels: { ...(await modularService.getLineModules({ id: project._id, userId: user._id })).spl.metamodels, [settings.location]: '0.1.0' } });
  expect(check.ok).toBe(true);
  const current = (await modularService.getLineModules({ id: project._id, userId: user._id })).spl.metamodels;
  await modularService.saveLineModules({ id: project._id, userId: user._id, metamodels: { ...current, [settings.location]: '0.1.0' } });
  expect((await modularService.getLineModules({ id: project._id, userId: user._id })).spl.metamodels[settings.location]).toBe('0.1.0');
  // what pinning a metamodel of a project would compose is its feature model, not nothing: that is what the impact on its products compares
  const proposed = await modularService.proposedFeatureModel({ id: project._id, userId: user._id, metamodels: { ...current, [settings.location]: '0.1.0' } });
  expect(proposed.length).toBeGreaterThan(0);
  // a line that cannot be read is counted; the kind stored for a line is not trusted to skip it
  const asked = [];
  const partial = await usageOf({
    location: um.location,
    lines: [{ _id: 'a', kind: 'plain' }, { _id: 'b', kind: 'modular' }, { _id: 'c', kind: 'modular' }],
    pinsOf: async (line) => { asked.push(line._id); if (line._id === 'b') throw new Error('host down'); return null; },
  });
  expect(asked.sort()).toEqual(['a', 'b', 'c']);
  expect(partial).toEqual({ location: um.location, unreadable: 1, lines: [] });
  // modules are for modular lines only
  await expect(modularService.saveLineModules({ id: project._id, userId: user._id, modules: {} })).rejects.toBeInstanceOf(LineNotModularError);
});

test('registry: lists what is registered, suggests the rest, and is only a catalog', async () => {
  const user = await admin();
  const group = gitlabDouble().state.createGroup({ name: 'registry' });
  const sensors = await publishMetamodel({ userId: user._id, namespaceId: group.id, name: 'sensors', grammar: BASIC_GRAMMAR.replace('Basic', 'Sensors').replace('basic', 'sensors') });
  const draft = await packageService.create({ userId: user._id, kind: 'module', name: 'draft', namespaceId: group.id });

  // without LINEA_REGISTRY the packages are found by their topic, as they always were, and there is nothing to register in
  expect(await registryService.status()).toEqual({ configured: false, location: null });
  expect((await packageService.list({ userId: user._id, kind: 'metamodel' })).map((p) => p.name)).toEqual(['common', 'featuremodel', 'sensors']);
  await expect(registryService.register({ userId: user._id, location: sensors.location })).rejects.toBeInstanceOf(RegistryNotConfiguredError);

  process.env.LINEA_REGISTRY = 'gitlab:registry/index';
  try {
    expect(await registryService.status()).toEqual({ configured: true, location: 'gitlab:registry/index' });
    // nothing is registered yet, so nothing is listed, but the packages of the host are offered
    expect(await packageService.list({ userId: user._id, kind: 'metamodel' })).toEqual([]);
    expect((await registryService.suggestions({ userId: user._id, kind: 'metamodel' })).map((p) => p.name)).toEqual(['common', 'featuremodel', 'sensors']);

    const entry = await registryService.register({ userId: user._id, location: sensors.location });
    expect(entry).toMatchObject({ kind: 'metamodel', location: sensors.location, name: 'sensors', description: 'sensors metamodel', addedBy: expect.any(String) });
    expect(await packageService.list({ userId: user._id, kind: 'metamodel' })).toEqual([expect.objectContaining({ name: 'sensors', versions: ['0.1.0'], latest: '0.1.0' })]);
    expect(await packageService.list({ userId: user._id, kind: 'module' })).toEqual([]);
    expect((await registryService.suggestions({ userId: user._id, kind: 'metamodel' })).map((p) => p.name)).toEqual(['common', 'featuremodel']);

    // what is not published, or is not a package, cannot be registered
    await expect(registryService.register({ userId: user._id, location: draft.location })).rejects.toMatchObject({ code: 'MODULE_RESOLUTION_FAILED' });
    expect(await registryService.entries({ userId: user._id })).toHaveLength(1);

    // a package made with `register` is listed at once, even before it has a version
    const made = await packageService.create({ userId: user._id, kind: 'module', name: 'fresh', namespaceId: group.id, register: true });
    expect((await packageService.list({ userId: user._id, kind: 'module' })).map((p) => [p.name, p.versions])).toEqual([['fresh', []]]);
    expect(made.location).toBe('gitlab:registry/fresh');

    // the catalog lists; it does not decide what resolves: an SPL can use a package that is not registered
    const line = await lineService.createLine({ userId: user._id, name: 'OutsideLine', version: '1.0.0', description: 'x', kind: 'modular' });
    const unregisteredModule = await packageService.create({ userId: user._id, kind: 'module', name: 'outside', namespaceId: group.id });
    await packageService.publish({ userId: user._id, kind: 'module', id: unregisteredModule.id });
    await modularService.saveLineModules({ id: line._id, userId: user._id, modules: { [unregisteredModule.location]: '^0.1.0' } }); // throws when it does not resolve
    expect(JSON.stringify(await modularService.getLineModules({ id: line._id, userId: user._id }))).toContain(unregisteredModule.location);

    await registryService.unregister({ userId: user._id, location: sensors.location });
    expect(await packageService.list({ userId: user._id, kind: 'metamodel' })).toEqual([]);
  } finally {
    delete process.env.LINEA_REGISTRY;
  }
});

test('studio: the files of a metamodel, the metamodels it needs, and its files saved together', async () => {
  const user = await admin();
  const group = gitlabDouble().state.createGroup({ name: 'registry' });
  const basic = await publishMetamodel({ userId: user._id, namespaceId: group.id, name: 'basic', grammar: BASIC_GRAMMAR });
  const extra = await packageService.create({ userId: user._id, kind: 'metamodel', name: 'extra', namespaceId: group.id });
  await write(user._id, 'metamodel', extra.id, {
    'metamodel.json': JSON.stringify({ name: 'extra', version: '0.1.0', requires: { [basic.location]: '^0.1.0' } }),
    'constraints/extra.js': 'return []',
    'visualizations/extra.js': VIEWS,
    'cases/extra.json': '[]',
  });

  const studio = await packageService.studio({ userId: user._id, kind: 'metamodel', id: extra.id });
  expect(studio).toMatchObject({ location: extra.location, version: '0.1.0', metamodel: 'extra', diagnostics: [] });
  expect(studio.files.grammar).toContain('grammar Extra');
  expect(studio.files).toMatchObject({ constraints: 'return []', cases: '[]', visualizations: VIEWS });
  expect(studio.paths.visualizations).toBe('visualizations/extra.js');
  expect(studio.files.spec).toBeUndefined();
  expect(Object.keys(studio.dependencies)).toEqual(['basic']);
  expect(studio.dependencies.basic.grammar).toContain('grammar Basic');

  // the studio saves what it edited in one go; a manifest that is not valid stops all of it
  const saved = await packageService.saveFiles({
    userId: user._id, kind: 'metamodel', id: extra.id, message: 'Edit extra',
    files: { 'grammars/extra.langium': 'grammar Extra\n// edited\n', 'specs/extra.js': 'return {}', 'cases/extra.json': null },
  });
  expect(saved).toMatchObject({ committed: true });
  const again = await packageService.studio({ userId: user._id, kind: 'metamodel', id: extra.id });
  expect(again.files).toMatchObject({ grammar: 'grammar Extra\n// edited\n', spec: 'return {}', constraints: 'return []' });
  expect(again.files.cases).toBeUndefined();
  await expect(packageService.saveFiles({ userId: user._id, kind: 'metamodel', id: extra.id, files: { 'scopes/extra.js': 'x', 'metamodel.json': '{' } }))
    .rejects.toMatchObject({ code: 'MODULE_MANIFEST_INVALID' });
  expect((await packageService.studio({ userId: user._id, kind: 'metamodel', id: extra.id })).files.scope).toBeUndefined();

  // a requirement that cannot be resolved is reported, and the metamodel can still be edited on its own
  await write(user._id, 'metamodel', extra.id, { 'metamodel.json': JSON.stringify({ name: 'extra', version: '0.1.0', requires: { 'gitlab:registry/nothing': '^1.0.0' } }) });
  const alone = await packageService.studio({ userId: user._id, kind: 'metamodel', id: extra.id });
  expect(alone.diagnostics).toEqual([expect.objectContaining({ severity: 'error' })]);
  expect(alone.files.grammar).toContain('edited');
  expect(alone.dependencies).toEqual({});

  // only a metamodel has a studio
  const mod = await packageService.create({ userId: user._id, kind: 'module', name: 'plain', namespaceId: group.id });
  await expect(packageService.studio({ userId: user._id, kind: 'module', id: mod.id })).rejects.toBeInstanceOf(PackageNotFoundError);
});
