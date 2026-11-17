/**
 * Fills a running dev stack with demo data through the HTTP API: several modular lines, a handful of products each, and a run of
 * generations, so the home page has lines, health and a deployment history to show. Additive: nothing is deleted.
 *
 *   node dev/seed.mjs                  (API at http://127.0.0.1:3000/api; API=… to change it; PRODUCTS=6 products per line)
 *
 * The git host is the in-memory one: restarting it forgets the repositories, so clear server/.dev-data and seed again then.
 */
const API = process.env.API ?? 'http://127.0.0.1:3000/api';
const PRODUCTS = Number(process.env.PRODUCTS ?? 6);
const ROUNDS = Number(process.env.ROUNDS ?? 2);
const stamp = Date.now().toString(36).slice(-4);

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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return data;
};

// the smallest valid selection of a UVL feature model: the root, every mandatory feature, the first of each or / alternative group
const GROUPS = new Set(['mandatory', 'optional', 'or', 'alternative']);
const smallestSelection = (uvl) => {
  const rows = uvl.split(/\r?\n/);
  const from = rows.findIndex((l) => /^features\s*$/.test(l.trimEnd()));
  const root = { children: [], width: -1 };
  const stack = [root];
  for (const raw of rows.slice(from + 1)) {
    if (!raw.trim()) continue;
    if (/^\S/.test(raw)) break;
    const width = raw.length - raw.trimStart().length;
    const text = raw.trim();
    const node = { name: text.split(/[\s{[]/)[0].replace(/^['"]|['"]$/g, ''), group: GROUPS.has(text) ? text : null, children: [], width };
    while (stack.at(-1).width >= width) stack.pop();
    stack.at(-1).children.push(node);
    stack.push(node);
  }
  const chosen = [];
  const take = (feature) => {
    chosen.push(feature.name);
    for (const group of feature.children.filter((c) => c.group)) {
      const members = group.children.filter((c) => !c.group);
      if (group.group === 'mandatory') members.forEach(take);
      else if ((group.group === 'or' || group.group === 'alternative') && members[0]) take(members[0]);
    }
  };
  take(root.children[0]);
  return chosen;
};

const { primary } = await call('GET', '/users/config');
const session = primary === 'local'
    ? await call('POST', '/users/login/local', { username: 'dev', password: 'devdevdev' })
    : await call('POST', `/users/login/${primary}`, { code: 'dev-code' });
token = session.token ?? session.accessToken ?? session;
const registry = await call('GET', '/packages/module');
const mod = (name) => registry.find((m) => m.name === name);
const range = (name) => ({ [mod(name).location]: `^${mod(name).latest}` });

const LINES = [
  { name: 'Customer Portal', description: 'Self-service portal for customers', modules: ['main-component', 'user-management-component', 'data-management-component'] },
  { name: 'Field Operations', description: 'Mobile workflows for field teams', modules: ['main-component', 'mobile-workflow-management-component', 'data-browser-component'] },
  { name: 'GIS Platform', description: 'Maps and sensor monitoring', modules: ['main-component', 'map-viewer-component', 'sensor-viewer-component'] },
  { name: 'Back Office', description: 'Internal administration tools', modules: ['main-component', 'graphical-user-interface-component', 'user-management-component', 'data-browser-component'] },
];

const products = [];
for (const spec of LINES) {
  if (spec.modules.some((m) => !mod(m))) { console.log(`skip ${spec.name}: a module is not in the registry`); continue; }
  try {
    const name = `${spec.name.replace(/\s+/g, '-')}-${stamp}`;
    const line = await call('POST', '/lines', { name, version: '1.0.0', description: spec.description, kind: 'modular' });
    await call('PUT', `/lines/${line._id}/modules`, { modules: Object.assign({}, ...spec.modules.map(range)) });
    const features = smallestSelection((await call('GET', `/lines/${line._id}/modules`)).featureModel);
    for (let i = 1; i <= PRODUCTS; i++) {
      const product = await call('POST', '/products', {
        lineId: line._id,
        spec: { basicData: { name: `${spec.name.replace(/\s+/g, '-')}-${stamp}-${i}`, version: '0.0.0', database: {}, languages: ['en'] }, dataModel: { cells: [] }, features, statics: [] },
      });
      products.push(product);
    }
    console.log(`line "${name}": ${PRODUCTS} products`);
  } catch (error) {
    console.log(`line "${spec.name}" failed: ${error.message}`);
  }
}

let ok = 0, failed = 0;
for (let round = 0; round < ROUNDS; round++) {
  for (const product of products) {
    try { await call('POST', `/products/${product._id}/generate`); ok++; } catch { failed++; }
  }
  console.log(`generation round ${round + 1}/${ROUNDS}: ${ok} ok, ${failed} failed`);
}
console.log(`done: ${products.length} products, ${ok} generations`);
