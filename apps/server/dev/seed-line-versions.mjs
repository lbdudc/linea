/**
 * Gives the lines of a running dev stack a history of versions, through the HTTP API: every save of the modules of a modular line,
 * and of the feature model of a monolithic one, is a version of the line (a tag of its repository). It also makes two monolithic lines
 * (the seed of the home page only makes modular ones) so the history of both kinds can be looked at.
 *
 *   node dev/seed-line-versions.mjs      (API at http://127.0.0.1:3000/api; API=… to change it; STEPS=5 versions per line)
 *
 * Additive, and only through what the app does: nothing is deleted.
 */
const API = process.env.API ?? 'http://127.0.0.1:3000/api';
const STEPS = Number(process.env.STEPS ?? 5);
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
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`), { status: res.status });
  return data;
};

const { primary } = await call('GET', '/users/config');
const session = primary === 'local'
    ? await call('POST', '/users/login/local', { username: 'dev', password: 'devdevdev' })
    : await call('POST', `/users/login/${primary}`, { code: 'dev-code' });
token = session.token ?? session.accessToken ?? session;

const registry = await call('GET', '/packages/module');
console.log(`registry: ${registry.length} modules`);

// -- the modular lines: add a module, tweak the versions it accepts, take it out, add another one …
const lines = await call('GET', '/lines/enrolled');
let versions = 0;
for (const line of lines.filter((l) => l.modular)) {
  let current;
  try {
    current = (await call('GET', `/lines/${line._id}/modules`)).spl?.modules ?? {};
  } catch (error) {
    console.log(`"${line.name}": ${error.message}`);
    continue;
  }
  const save = async (modules, why) => {
    try {
      await call('PUT', `/lines/${line._id}/modules`, { modules });
      current = modules;
      versions++;
      console.log(`"${line.name}": ${why}`);
      return true;
    } catch {
      return false;
    }
  };
  const notIn = () => registry.filter((m) => !(m.location in current));
  const added = [];
  for (let step = 0; step < STEPS; step++) {
    const kind = step % 3;
    if (kind === 0) {
      for (const candidate of notIn()) {
        if (await save({ ...current, [candidate.location]: candidate.latest ? `^${candidate.latest}` : '*' }, `+ ${candidate.name}`)) {
          added.push(candidate.location);
          break;
        }
      }
    } else if (kind === 1) {
      const location = Object.keys(current)[0];
      if (location) {
        const loose = current[location] === '*';
        const pkg = registry.find((m) => m.location === location);
        await save({ ...current, [location]: loose && pkg?.latest ? `^${pkg.latest}` : '*' }, `~ ${pkg?.name ?? location}`);
      }
    } else if (added.length) {
      const location = added.pop();
      const { [location]: _gone, ...rest } = current;
      await save(rest, `− ${registry.find((m) => m.location === location)?.name ?? location}`);
    }
  }
}

// -- plain lines, with a feature model that grows
const MODEL = (features) => `featuremodel ERP feature ERP {\n  mandatory {\n    feature Core\n  }\n  optional {\n${features.map((f) => `    feature ${f}\n`).join('')}  }\n}\n`;
const FEATURES = ['Billing', 'Inventory', 'Reports', 'Payroll', 'Notifications', 'Audit', 'Mobile'];
for (const name of [`Legacy-ERP-${stamp}`, `Kiosk-${stamp}`]) {
  try {
    const line = await call('POST', '/lines', { name, version: '1.0.0', description: 'Plain line for the history', kind: 'plain' });
    let features = FEATURES.slice(0, 2);
    await call('PUT', `/lines/${line._id}/model`, { content: MODEL(features) });
    for (let step = 0; step < STEPS; step++) {
      if (step % 3 === 2) features = features.slice(1);
      else features = [...features, FEATURES[(features.length + step) % FEATURES.length]].filter((f, i, all) => all.indexOf(f) === i);
      await call('PUT', `/lines/${line._id}/model`, { content: MODEL(features) });
      versions++;
    }
    console.log(`line "${name}": ${STEPS} versions`);
  } catch (error) {
    console.log(`line "${name}" failed: ${error.message}`);
  }
}
console.log(`done: ${versions} versions kept`);
