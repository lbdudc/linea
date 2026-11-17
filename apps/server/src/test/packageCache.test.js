import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from 'vitest';
import { createMemoryPackageSource } from '@lbdudc/linea-core';
import { cachedPackageSource } from '../model/services/modules/packageCache.js';

const packages = { 'local:registry/modules/a': { '1.0.0': { 'module.json': '{"v":1}', 'src/x.js': 'x' } } };

test('a package version is downloaded once and read from disk after that', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-cache-'));
  const opened = [];
  const base = createMemoryPackageSource({ packages, revisions: { 'local:registry/modules/a': { '1.0.0': 'abc' } } });
  const source = { ...base, open: (args) => { opened.push(args); return base.open(args); } };
  const stats = { fetched: 0, hits: 0 };

  const first = await cachedPackageSource({ source, root, stats }).open({ location: 'local:registry/modules/a', version: '1.0.0' });
  const second = await cachedPackageSource({ source, root, stats }).open({ location: 'local:registry/modules/a', version: '1.0.0' });

  expect(opened).toHaveLength(1);
  expect(stats).toEqual({ fetched: 1, hits: 1 });
  expect(await first.list({ dir: '' })).toEqual(['module.json', 'src/x.js']);
  expect(new TextDecoder().decode(await second.read({ path: 'src/x.js' }))).toBe('x');
  expect(await second.read({ path: 'missing' })).toBeUndefined();
});

test('a version published again with another revision is not served from the old copy', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-cache-'));
  const location = 'local:registry/modules/a';
  const before = createMemoryPackageSource({ packages, revisions: { [location]: { '1.0.0': 'one' } } });
  const after = createMemoryPackageSource({
    packages: { [location]: { '1.0.0': { 'module.json': '{"v":2}' } } },
    revisions: { [location]: { '1.0.0': 'two' } },
  });

  await cachedPackageSource({ source: before, root }).open({ location, version: '1.0.0' });
  const files = await cachedPackageSource({ source: after, root }).open({ location, version: '1.0.0' });

  expect(new TextDecoder().decode(await files.read({ path: 'module.json' }))).toBe('{"v":2}');
});
