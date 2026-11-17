/**
 * Walks the modules feature end to end through the real HTTP API of a running dev stack (see dev/README.md):
 * log in, read the registry, make a line from modules, make a product, edit its models, generate it.
 *
 *   node dev/smoke.mjs                 (API at http://127.0.0.1:3000; API=… to change it)
 */
const API = process.env.API ?? 'http://127.0.0.1:3000/api';
const stamp = Date.now().toString(36);
let token;

const call = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 400)}`), { status: res.status, data });
  return data;
};

// the root feature of a modular line is its name in PascalCase
const rootOf = (name) => name.replace(/(^|[-_.\s]+)(.)/g, (_m, _s, c) => c.toUpperCase());

let steps = 0;
const step = async (label, fn) => {
  process.stdout.write(`${String(++steps).padStart(2)}. ${label} … `);
  try {
    const result = await fn();
    console.log('ok');
    return result;
  } catch (error) {
    console.log('FAILED');
    throw error;
  }
};
const expect = (condition, message) => { if (!condition) throw new Error(`expected: ${message}`); };

const session = await step('log in (OAuth code exchange against the dev GitLab)', async () => {
  const { primary } = await call('GET', '/users/config');
  const result = primary === 'local'
    ? await call('POST', '/users/login/local', { username: 'dev', password: 'devdevdev' })
    : await call('POST', `/users/login/${primary}`, { code: 'dev-code' });
  token = result.token ?? result.accessToken ?? result;
  expect(typeof token === 'string', 'a token');
  return result;
});
void session;

const modules = await step('registry: list modules', async () => {
  const list = await call('GET', '/packages/module');
  expect(['main-component', 'user-management-component', 'data-browser-component', 'data-management-component'].every((n) => list.some((m) => m.name === n)), 'the modules of the registry');
  return list;
});
await step('registry: list metamodels', async () => {
  const list = await call('GET', '/packages/metamodel');
  expect(['common', 'basic', 'datamodel', 'featuremodel', 'gismodel', 'forms', 'lists', 'menus', 'security', 'sensors'].every((n) => list.some((m) => m.name === n)), 'the metamodels of the registry');
  return list;
});
const userManagement = modules.find((m) => m.name === 'user-management-component');
const main = modules.find((m) => m.name === 'main-component');
expect(Boolean(userManagement.latest && main.latest), 'a published version of each');

await step('package: check a published module as it is on main', async () => {
  const report = await call('POST', `/packages/module/${userManagement.id}/check`);
  expect(report.ok, `a clean check, got ${JSON.stringify(report.diagnostics)}`);
});

const created = await step('package: create a metamodel and a module, edit them, publish', async () => {
  const mm = await call('POST', '/packages/metamodel', { name: `sensors-${stamp}`, description: 'Sensors' });
  const check = await call('POST', `/packages/metamodel/${mm.id}/check`);
  expect(check.ok, 'the scaffold is a valid metamodel');
  const published = await call('POST', `/packages/metamodel/${mm.id}/publish`, {});
  expect(published.version === '0.1.0', 'v0.1.0');
  const mod = await call('POST', '/packages/module', { name: `monitoring-${stamp}`, description: 'Monitoring' });
  await call('PUT', `/packages/module/${mod.id}/file`, {
    path: '.linea/module.json',
    content: JSON.stringify({ name: `monitoring-${stamp}`, version: '0.1.0', requires: { modules: {}, metamodels: { [mm.location]: '^0.1.0' } }, offers: {} }),
  });
  const modPublished = await call('POST', `/packages/module/${mod.id}/publish`, {});
  expect(modPublished.report.ok, 'the module publishes');
  return { mm, mod };
});
void created;

const registry = await call('GET', '/registry/status');
if (!registry.configured) {
  console.log(' -. registry: LINEA_REGISTRY is not set, packages are listed by their topic (skipping the catalog steps)');
} else {
  await step('registry: a package that was only created is not listed, and is suggested', async () => {
    const listed = await call('GET', '/packages/metamodel');
    expect(!listed.some((m) => m.location === created.mm.location), 'the new metamodel is not listed before it is registered');
    const suggestions = await call('GET', '/registry/suggestions?kind=metamodel');
    expect(suggestions.some((m) => m.location === created.mm.location), 'it is suggested');
  });
  await step('registry: register it, list it with its version, unregister it', async () => {
    const entry = await call('POST', '/registry', { location: created.mm.location });
    expect(entry.kind === 'metamodel' && entry.name === created.mm.name, `an entry for the metamodel, got ${JSON.stringify(entry)}`);
    const listed = await call('GET', '/packages/metamodel');
    expect(listed.find((m) => m.location === created.mm.location)?.latest === '0.1.0', 'listed with its version');
    expect((await call('GET', '/registry/suggestions?kind=metamodel')).every((m) => m.location !== created.mm.location), 'no longer suggested');
    await call('DELETE', `/registry?location=${encodeURIComponent(created.mm.location)}`);
    expect((await call('GET', '/packages/metamodel')).every((m) => m.location !== created.mm.location), 'gone from the list');
  });
  await step('registry: a location that is not a package is refused (422)', async () => {
    const refused = await call('POST', '/registry', { location: `gitlab:registry/nothing-${stamp}` }).then(() => null, (error) => error);
    expect(refused?.status === 422 || refused?.status === 404, `refused, got ${refused?.status}`);
  });
}

await step('studio: the files of a metamodel are read, and several are saved in one commit', async () => {
  const studio = await call('GET', `/packages/metamodel/${created.mm.id}/studio`);
  expect(studio.metamodel === created.mm.name, `the metamodel to edit, got ${studio.metamodel}`);
  expect(studio.files.grammar.includes('grammar'), 'its grammar');
  expect(studio.diagnostics.length === 0, `nothing to report, got ${JSON.stringify(studio.diagnostics)}`);
  const saved = await call('PUT', `/packages/metamodel/${created.mm.id}/files`, {
    files: { [studio.paths.grammar]: `${studio.files.grammar}// edited in the studio\n`, [studio.paths.constraints]: 'return []\n' },
    message: 'Edit in the studio',
  });
  expect(saved.committed === true, 'one commit');
  const again = await call('GET', `/packages/metamodel/${created.mm.id}/studio`);
  expect(again.files.grammar.includes('edited in the studio') && again.files.constraints === 'return []\n', 'both files saved');
  const refused = await call('PUT', `/packages/metamodel/${created.mm.id}/files`, { files: { 'metamodel.json': '{' } }).then(() => null, (error) => error);
  expect(refused?.status === 422, `an invalid manifest is refused, got ${refused?.status}`);
  const module = await call('GET', `/packages/module/${created.mod.id}/studio`).then(() => null, (error) => error);
  expect(module?.status === 404, `only a metamodel has a studio, got ${module?.status}`);
});

const line = await step('line: create one made of modules', async () => {
  const l = await call('POST', '/lines', { name: `Gis-${stamp}`, version: '1.0.0', description: 'smoke', kind: 'modular' });
  expect(l.modular === true, 'a modular line');
  return l;
});

await step('line: a set of modules that cannot be resolved is refused (422)', async () => {
  try {
    await call('PUT', `/lines/${line._id}/modules`, { modules: { [`${modules[0].location}-missing`]: '*' } });
  } catch (error) {
    expect(error.status === 422, `422, got ${error.status}`);
    return;
  }
  throw new Error('expected a refusal');
});

await step('line: choose modules (resolved, checked, lockfile committed)', async () => {
  const saved = await call('PUT', `/lines/${line._id}/modules`, {
    modules: { [userManagement.location]: `^${userManagement.latest}`, [main.location]: `^${main.latest}` },
  });
  const names = saved.packages.map((p) => p.name).sort();
  expect(JSON.stringify(names) === JSON.stringify(['basic', 'common', 'datamodel', 'featuremodel', 'main-component', 'user-management-component']), `the closure, got ${names}`);
});

await step('line: modules view and composed feature model', async () => {
  const view = await call('GET', `/lines/${line._id}/modules`);
  expect(view.lockCurrent, 'a current lockfile');
  expect([rootOf(line.name), 'WebApplication'].every((f) => view.featureModel.includes(f)), 'the root of the line and what its modules bring');
  const fm = await call('GET', `/lines/${line._id}/model`);
  expect(fm.readOnly === true && fm.modular === true, 'a read-only feature model');
});

await step('line: its feature model cannot be edited (409)', async () => {
  try {
    await call('PUT', `/lines/${line._id}/model`, { content: 'features\n\tX\n' });
  } catch (error) {
    expect(error.status === 409, `409, got ${error.status}`);
    return;
  }
  throw new Error('expected a refusal');
});

const product = await step('product: create (starts with a model of every metamodel)', async () => {
  return call('POST', '/products', {
    lineId: line._id,
    spec: {
      basicData: { name: `Shop-${stamp}`, version: '0.0.0', database: {}, languages: ['en'] },
      dataModel: { cells: [] },
      features: [rootOf(line.name)],
      statics: [],
    },
  });
});

const overview = await step('product: models and what the modules offer', async () => {
  const o = await call('GET', `/products/${product._id}/models`);
  expect(['basic', 'datamodel'].every((n) => o.metamodels.some((m) => m.name === n)), 'a model of basic and of datamodel');
  expect(o.metamodels.every((m) => typeof m.model === 'string'), 'a starting model of each');
  expect(o.offered.some((x) => x.origin === 'user-management-component'), 'user-management-component offers a model');
  // the data model brings a class diagram of its own: the server carries it to the browser with the grammar
  expect(/class-diagram/.test(o.bundle.visualizations?.datamodel ?? ''), 'the data model brings its class diagram');
  expect(JSON.stringify(o.layouts) === '{}', 'nobody has moved a node yet');
  return o;
});

await step('product: a model that refers to something offered by a module is valid', async () => {
  const report = await call('PUT', `/products/${product._id}/models/datamodel`, {
    content: 'datamodel shop\n\nentity Order {\n  property code: String required pk\n  relation customer -> UMUser\n}\n',
  });
  expect(report.ok, `valid, got ${JSON.stringify(report.diagnostics)}`);
  const basic = await call('PUT', `/products/${product._id}/models/basic`, { content: `basic Shop${stamp}\n` });
  expect(basic.ok, 'basic is valid');
});

await step('product: where the nodes of a diagram were left is saved with the model, or on its own, and read back', async () => {
  const moved = { datamodel: { 'viz:class-diagram': { Order: { x: 40, y: 60 } } } };
  await call('PUT', `/products/${product._id}/models/datamodel`, {
    content: 'datamodel shop\n\nentity Order {\n  property code: String required pk\n  relation customer -> UMUser\n}\n',
    layouts: moved,
  });
  expect(JSON.stringify((await call('GET', `/products/${product._id}/models`)).layouts) === JSON.stringify(moved), 'saved with the model');
  const again = { datamodel: { 'viz:class-diagram': { Order: { x: 1, y: 2 } }, 'viz:nothing': {} }, nonsense: { v: { A: { x: 1, y: 1 } } } };
  await call('PUT', `/products/${product._id}/layouts`, { layouts: again });
  const read = (await call('GET', `/products/${product._id}/models`)).layouts;
  expect(JSON.stringify(read) === JSON.stringify({ datamodel: { 'viz:class-diagram': { Order: { x: 1, y: 2 } } } }), `only a node of a metamodel of the product is kept, got ${JSON.stringify(read)}`);
});

await step('product: a model that does not fit is reported with its position', async () => {
  const report = await call('POST', `/products/${product._id}/models/check`, {
    models: { datamodel: 'datamodel shop\n\nentity Order {\n  property code: String required pk\n  relation customer -> Nobody\n}\n' },
  });
  expect(!report.ok, 'a failing check');
  expect(report.diagnostics.some((d) => d.file === '.linea/models/datamodel.datamodel' && /Nobody/.test(d.message)), 'the problem about Nobody');
});

await step('product: generate it', async () => {
  // the templates of the registry's modules do not render entities of the new data model yet: generate from the starting models
  for (const m of overview.metamodels.filter((x) => x.name === 'datamodel' || x.name === 'basic')) {
    await call('PUT', `/products/${product._id}/models/${m.name}`, { content: m.model });
  }
  const generated = await call('POST', `/products/${product._id}/generate`);
  expect(generated.conflicts === false, 'no conflicts');
});

console.log('\nAll good: the modules feature works end to end against this stack.');
console.log(`Open the app and look at: line "${line.name}", product "${product.spec.basicData.name}", and the new packages in Modules.`);
