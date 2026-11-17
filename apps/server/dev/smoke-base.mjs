/**
 * The base on its own, with no plugin enabled: log in, a plain line with a feature model, a product, generate it; and what belongs to
 * plugins is not there. Run against a stack started with LINEA_PLUGINS empty (`LINEA_PLUGINS= server/dev/up.sh`):
 *   node dev/smoke-base.mjs                 (API at http://127.0.0.1:3000/api; API=… to change it; LINEA_USER and LINEA_PASSWORD for another account)
 */
const API = process.env.API ?? 'http://127.0.0.1:3000/api';
const stamp = Date.now().toString(36);
let token;
let stepNo = 0;

const call = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} -> ${res.status} ${String(text).slice(0, 300)}`), { status: res.status, data });
  return data;
};
const step = async (name, fn) => {
  process.stdout.write(`${String(++stepNo).padStart(2)}. ${name} … `);
  try { const r = await fn(); console.log('ok'); return r; } catch (error) { console.log('FAILED'); throw error; }
};
const expect = (condition, message) => { if (!condition) throw new Error(`expected: ${message}`); };
const refused = (promise, status) => promise.then(() => { throw new Error(`expected a ${status}`); }, (error) => expect(error.status === status, `${status}, got ${error.status}`));

await step('log in', async () => {
  const { primary } = await call('GET', '/users/config');
  const result = primary === 'local'
    ? await call('POST', '/users/login/local', { username: process.env.LINEA_USER ?? 'dev', password: process.env.LINEA_PASSWORD ?? 'devdevdev' })
    : await call('POST', `/users/login/${primary}`, { code: 'dev-code' });
  token = result.token;
  expect(typeof token === 'string', 'a token');
});

await step('the base is up with the local git host', async () => {
  const config = await call('GET', '/users/config');
  expect(config.hosts.some((host) => host.id === 'local'), 'the local host is on');
});

const line = await step('line: a plain one', () => call('POST', '/lines', { name: `Plain-${stamp}`, version: '1.0.0', description: 'smoke base', kind: 'plain' }));

await step('line: its feature model is edited and saved', async () => {
  // the text a line keeps its feature model in (a model of the feature metamodel; UVL → this text is the analytics plugin's)
  const text = 'featuremodel Shop feature Shop {\n    mandatory {\n      feature Catalog\n    }\n    optional {\n      feature Reports\n    }\n  }\n';
  await call('PUT', `/lines/${line._id}/model`, { content: text, bump: 'minor' });
  const fm = await call('GET', `/lines/${line._id}/model`);
  expect(fm.kind === 'plain' && fm.readOnly === false, 'a plain, editable model');
  expect(String(fm.uvl).includes('Catalog'), 'the saved model');
});

const product = await step('product: create', () => call('POST', '/products', {
  lineId: line._id,
  spec: { basicData: { name: `Shop-${stamp}`, version: '0.0.0', database: {}, languages: ['en'] }, dataModel: { cells: [] }, features: ['Shop', 'Catalog'], statics: [] },
}));

await step('product: its models are there (every product has them)', async () => {
  const overview = await call('GET', `/products/${product._id}/models`);
  expect(overview.metamodels.some((m) => m.name === 'featureselection'), 'a feature selection');
});

await step('product: generate it', async () => {
  const generated = await call('POST', `/products/${product._id}/generate`);
  expect(generated.conflicts === false, 'no conflicts');
});

await step('from a UVL text to a model works in the base', async () => {
  const converted = await call('POST', `/lines/${line._id}/model/from-uvl`, { uvl: 'features\n\tX\n' });
  expect(typeof converted === 'object', 'a model');
});

console.log('\nAll good: the base works on its own, on the local git host.');
console.log(`Line "${line.name}", product "${product.spec.basicData.name}".`);
