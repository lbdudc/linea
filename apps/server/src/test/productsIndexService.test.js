import { test, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { parseProductsIndex, ProductsIndexError } from '@lbdudc/linea-core';
import { getGitProvider } from '../model/git/index.js';
import ProductsIndexService from '../model/services/ProductsIndexService.js';
import { setupGitlabDouble, resetGitlabDouble, teardownGitlabDouble, gitlabDouble } from './support/withGitlabDouble.js';

beforeAll(setupGitlabDouble);
afterEach(resetGitlabDouble);
afterAll(teardownGitlabDouble);

async function readIndex(projectId) {
  const meta = await getGitProvider().getFileRevision({ token: 'fake', id: projectId, path: 'products.json', ref: 'main' });
  return parseProductsIndex({ content: Buffer.from(meta.content, 'base64').toString('utf8') });
}

test('addProduct creates products.json when absent (create, no last_commit_id)', async () => {
  const project = gitlabDouble().seedProject({ name: 'FreshLine', topics: ['spl'] });
  const svc = new ProductsIndexService();

  const result = await svc.addProduct({
    token: 'fake', lineProjectId: project.id, name: 'P1', repositorio: 'FreshLine/p1', version: '0.1.0',
  });

  expect(result.attempts).toBe(1);
  expect(result.committed).toBe(true);
  expect(await readIndex(project.id)).toEqual({ productos: [{ name: 'P1', repositorio: 'FreshLine/p1', version: '0.1.0' }] });

  gitlabDouble().clearLog();
  await svc.addProduct({ token: 'fake', lineProjectId: project.id, name: 'P2', repositorio: 'FreshLine/p2' });
  const commitCall = gitlabDouble().getLog().find((l) => l.method === 'POST' && l.path.includes('repository/commits'));
  expect(commitCall.body.actions[0].action).toBe('update');
  expect(typeof commitCall.body.actions[0].last_commit_id).toBe('string');
});

test('renameProduct updates the name, leaves repositorio and version untouched', async () => {
  const project = gitlabDouble().seedProject({ name: 'RenameLine', topics: ['spl'] });
  const svc = new ProductsIndexService();
  await svc.addProduct({ token: 'fake', lineProjectId: project.id, name: 'Old', repositorio: 'RenameLine/old', version: '0.2.0' });

  await svc.renameProduct({ token: 'fake', lineProjectId: project.id, from: 'Old', to: 'New' });

  expect(await readIndex(project.id)).toEqual({ productos: [{ name: 'New', repositorio: 'RenameLine/old', version: '0.2.0' }] });
});

test('removeProduct removes the entry BY repositorio, and is idempotent when called again', async () => {
  const project = gitlabDouble().seedProject({ name: 'DeleteLine', topics: ['spl'] });
  const svc = new ProductsIndexService();
  await svc.addProduct({ token: 'fake', lineProjectId: project.id, name: 'Gone', repositorio: 'DeleteLine/gone' });

  await svc.removeProduct({ token: 'fake', lineProjectId: project.id, repositorio: 'DeleteLine/gone' });
  expect(await readIndex(project.id)).toEqual({ productos: [] });

  const second = await svc.removeProduct({ token: 'fake', lineProjectId: project.id, repositorio: 'DeleteLine/gone' });
  expect(second.committed).toBe(false);
});

test('removeProduct is immune to a stale `name` — matches by repositorio, which rename never touches', async () => {
  const project = gitlabDouble().seedProject({ name: 'RenameThenDeleteLine', topics: ['spl'] });
  const svc = new ProductsIndexService();
  await svc.addProduct({ token: 'fake', lineProjectId: project.id, name: 'Old', repositorio: 'RenameThenDeleteLine/old' });
  await svc.renameProduct({ token: 'fake', lineProjectId: project.id, from: 'Old', to: 'New' });

  await svc.removeProduct({ token: 'fake', lineProjectId: project.id, repositorio: 'RenameThenDeleteLine/old' });
  expect(await readIndex(project.id)).toEqual({ productos: [] });
});

test('products.json absent when reading directly is treated as an empty index (no GitLab error surfaces)', async () => {
  const project = gitlabDouble().seedProject({ name: 'NoIndexYetLine', topics: ['spl'] });
  const svc = new ProductsIndexService();

  const result = await svc.addProduct({ token: 'fake', lineProjectId: project.id, name: 'First', repositorio: 'NoIndexYetLine/first' });
  expect(result.committed).toBe(true);
});

test('a corrupt products.json throws ProductsIndexError and the file is NOT overwritten', async () => {
  const project = gitlabDouble().seedProject({ name: 'CorruptLine', topics: ['spl'] });
  project.commit({
    branch: 'main',
    actions: [{ action: 'create', file_path: 'products.json', content: '{ not valid json' }],
    message: 'corrupt seed',
  });
  const svc = new ProductsIndexService();

  await expect(
    svc.addProduct({ token: 'fake', lineProjectId: project.id, name: 'P1', repositorio: 'CorruptLine/p1' })
  ).rejects.toBeInstanceOf(ProductsIndexError);

  const meta = await getGitProvider().getFileRevision({ token: 'fake', id: project.id, path: 'products.json', ref: 'main' });
  expect(Buffer.from(meta.content, 'base64').toString('utf8')).toBe('{ not valid json');
});

test('addProduct: two independent writers racing on the same line — both land, and a conflict costs at most one retry', async () => {
  const project = gitlabDouble().seedProject({ name: 'ConcurrentLine', topics: ['spl'] });
  project.commit({
    branch: 'main',
    actions: [{ action: 'create', file_path: 'products.json', content: '{"productos":[]}\n' }],
    message: 'seed empty index',
  });

  const svcA = new ProductsIndexService();
  const svcB = new ProductsIndexService();

  const [resultA, resultB] = await Promise.all([
    svcA.addProduct({ token: 'fake', lineProjectId: project.id, name: 'ProductA', repositorio: 'ConcurrentLine/producta' }),
    svcB.addProduct({ token: 'fake', lineProjectId: project.id, name: 'ProductB', repositorio: 'ConcurrentLine/productb' }),
  ]);

  const index = await readIndex(project.id);
  expect(index.productos.map((p) => p.name).sort()).toEqual(['ProductA', 'ProductB']);

  // whether the writers overlap depends on timing: the one that finds the other's commit in the way retries once
  const attempts = [resultA.attempts, resultB.attempts].sort((a, b) => a - b);
  expect(attempts[0]).toBe(1);
  expect(attempts[1]).toBeLessThanOrEqual(2);
});
