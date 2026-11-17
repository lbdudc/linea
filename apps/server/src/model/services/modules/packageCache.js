import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFsFiles } from '@lbdudc/linea-core';

const MAX_AGE_MS = 14 * 24 * 3600_000;
const COMPLETE = '.complete';

export const packageCacheDir = () => process.env.LINEA_PACKAGE_CACHE_DIR || path.join(os.tmpdir(), 'linea-package-cache');

const safe = (text) => String(text).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);

let pruned = false;
const prune = (root) => {
  if (pruned) return;
  pruned = true;
  try {
    for (const entry of fs.readdirSync(root)) {
      const dir = path.join(root, entry);
      if (Date.now() - fs.statSync(dir).mtimeMs > MAX_AGE_MS) fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // nothing cached yet
  }
};

const store = async ({ files, target }) => {
  const staging = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(staging, { recursive: true });
  try {
    for (const file of await files.list({ dir: '' })) {
      const bytes = await files.read({ path: file });
      if (bytes === undefined) continue;
      const destination = path.join(staging, 'files', ...file.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes);
    }
    fs.writeFileSync(path.join(staging, COMPLETE), '');
    try {
      fs.renameSync(staging, target);
    } catch {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
};

/**
 * A package source that keeps what it opens on disk, by `location@version` (and revision, when the host gives one: a version that is
 * published again with other contents is another entry). Opening the same version again, in this or any later generation, reads
 * the folder instead of the host. `stats` counts what was read from the host (`fetched`) and from disk (`hits`).
 */
export const cachedPackageSource = ({ source, root = packageCacheDir(), stats = { fetched: 0, hits: 0 } }) => {
  prune(root);
  return {
    ...source,
    stats,
    open: async ({ location, version }) => {
      const revision = await Promise.resolve(source.revision?.({ location, version })).catch(() => undefined);
      const target = path.join(root, `${safe(location)}@${safe(version)}${revision ? `@${safe(revision)}` : ''}`);
      if (!fs.existsSync(path.join(target, COMPLETE))) {
        const files = await source.open({ location, version });
        await store({ files, target });
        stats.fetched += 1;
      } else {
        stats.hits += 1;
        const now = new Date();
        fs.utimesSync(target, now, now);
      }
      return createFsFiles({ dir: path.join(target, 'files') });
    },
  };
};
