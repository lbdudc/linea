import fs from 'node:fs';
import path from 'node:path';

const filesOf = (root, at = '') => fs.readdirSync(path.join(root, at), { withFileTypes: true }).flatMap((entry) => {
  const relative = at ? `${at}/${entry.name}` : entry.name;
  if (!at && entry.name === 'products') return [];
  return entry.isDirectory() ? filesOf(root, relative) : [relative];
});

const subfolders = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const packagesOf = (dir) => {
  const names = new Map();
  for (const name of subfolders(path.join(dir, 'metamodels'))) names.set(name, 'metamodel');
  for (const name of subfolders(path.join(dir, 'modules'))) names.set(name, 'module');
  return names;
};

/**
 * Publishes the example lines of a folder (`examples/<line>/`, each with `products/<product>/`): a repository with the topic `spl` for
 * each line and one with the topic `product` for each product, which LINEA lists when it is opened. The packages they name are the ones
 * published from the same folder under `root`; the lines go under `group` (`root` when not given). A line that is already there is left alone.
 */
export const publishExamples = async ({ provider, token, root, group = root, dir, dryRun = false, log = console.log }) => {
  const examples = path.join(dir, 'examples');
  const lines = subfolders(examples).filter((name) => fs.existsSync(path.join(examples, name, 'spl.json')));
  if (lines.length === 0) return [];

  const packages = packagesOf(dir);
  const flat = !provider.nestsNamespaces;
  const repositoryOf = (name) => (flat ? `${root}/${name}` : `${root}/${packages.get(name) === 'metamodel' ? 'metamodels' : 'modules'}/${name}`);
  const relocate = (location) => {
    const name = location.split('/').at(-1);
    return packages.has(name) ? `${provider.kind}:${repositoryOf(name)}` : location;
  };
  const relocated = (map = {}) => Object.fromEntries(Object.entries(map).map(([location, value]) => [relocate(location), value]));
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

  const pinned = async (lock) => {
    const out = {};
    for (const [location, entry] of Object.entries(lock.packages ?? {})) {
      const target = relocate(location);
      const repository = await provider.findRepository({ token, path: target.slice(target.indexOf(':') + 1) });
      const tag = repository && await provider.getTag({ token, id: repository.id, tag: `v${entry.version}` });
      if (!tag) throw new Error(`${target} v${entry.version} is not published: publish the packages first`);
      out[target] = { ...entry, revision: tag.commitId };
    }
    return { ...lock, packages: out };
  };

  const contentOf = async (folder, file) => {
    const buffer = fs.readFileSync(path.join(folder, file));
    if (file === 'spl.json') {
      const spl = JSON.parse(buffer.toString('utf8'));
      return { content: json({ ...spl, metamodels: relocated(spl.metamodels), modules: relocated(spl.modules) }) };
    }
    if (file === 'linea.lock.json') return { content: json(await pinned(JSON.parse(buffer.toString('utf8')))) };
    if (file === '.linea/product.json') {
      const product = JSON.parse(buffer.toString('utf8'));
      return { content: json({ ...product, modules: relocated(product.modules) }) };
    }
    return buffer.includes(0) ? { content: buffer.toString('base64'), encoding: 'base64' } : { content: buffer.toString('utf8') };
  };

  const commitFolder = async ({ repository, branch, folder, message }) => {
    const existing = new Set(await provider.listFiles({ token, id: repository.id, ref: branch }).catch(() => []));
    const actions = [];
    for (const file of filesOf(folder)) actions.push({ action: existing.has(file) ? 'update' : 'create', path: file, ...(await contentOf(folder, file)) });
    await provider.commit({ token, id: repository.id, branch, message, actions });
    return actions.length;
  };

  const branchOff = async ({ repository, branch, ref }) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await provider.createBranch({ token, id: repository.id, branch, ref });
      } catch (error) {
        if ((await provider.listBranches({ token, id: repository.id }).catch(() => [])).includes(branch)) return null;
        if (attempt >= 10) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  };

  const results = [];
  let groupNamespace = await provider.findNamespace({ token, fullPath: group });
  for (const line of lines) {
    const folder = path.join(examples, line);
    const linePath = flat ? `${group}/${line}` : `${group}/${line}/${line}`;
    const products = subfolders(path.join(folder, 'products'));
    if (await provider.findRepository({ token, path: linePath })) {
      log(`= ${linePath}  is already there`);
      results.push({ line, path: linePath, status: 'already-there' });
      continue;
    }
    if (dryRun) {
      log(`- ${linePath}  (${filesOf(folder).length} files, products: ${products.join(', ') || 'none'})`);
      results.push({ line, path: linePath, status: 'dry-run' });
      continue;
    }
    if (!groupNamespace && !flat) groupNamespace = await provider.createNamespace({ token, name: group });
    const namespace = await provider.createNamespace({ token, name: line, parentId: groupNamespace?.id });
    const repository = await provider.createRepository({ token, name: line, namespaceId: namespace.id, topics: ['spl'] });
    const lineNamespace = repository.namespaceId ?? namespace.id;
    const count = await commitFolder({ repository, branch: 'main', folder, message: `The example line ${line}` });
    log(`+ ${repository.path}  (${count} files)`);

    const index = [];
    for (const product of products) {
      const productFolder = path.join(folder, 'products', product);
      const productNamespace = await provider.createNamespace({ token, name: product, parentId: lineNamespace });
      const productRepository = await provider.createRepository({ token, name: product, namespaceId: productNamespace.id, topics: ['product'] });
      await branchOff({ repository: productRepository, branch: 'bigbang', ref: productRepository.defaultBranch ?? 'main' });
      const files = await commitFolder({ repository: productRepository, branch: 'main', folder: productFolder, message: `The example product ${product}` });
      const spec = readJson(path.join(productFolder, '.linea', 'spec.draft.json')).spec ?? {};
      index.push({ name: spec.basicData?.name ?? product, repositorio: productRepository.path, version: spec.basicData?.version ?? '0.0.0' });
      log(`  + ${productRepository.path}  (${files} files)`);
    }
    const listed = await provider.listFiles({ token, id: repository.id, ref: 'main' });
    await provider.commit({
      token, id: repository.id, branch: 'main', message: 'products.json',
      actions: [{ action: listed.includes('products.json') ? 'update' : 'create', path: 'products.json', content: json({ productos: index }) }],
    });
    results.push({ line, path: repository.path, status: 'published', products: index.map((p) => p.repositorio) });
  }
  return results;
};
