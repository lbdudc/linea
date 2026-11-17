import fs from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { validateManifest } from './manifest.js';

// `${NAME}` or `${NAME:-default}` in a manifest's address: where a remote plugin is depends on the deployment
export const expand = (text, env) => text.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, name, fallback = '') => env[name] ?? fallback)

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const readJsonIfAny = async (file) => readJson(file).catch((error) => (error.code === 'ENOENT' ? null : Promise.reject(error)));

/**
 * The catalog of a plugins folder: `marketplace.json` (`{ plugins: [{ id, path, ...defaults }] }`, a path relative to the folder) and, in each
 * plugin's folder, `plugin.json` (its manifest, which wins over the catalog's defaults). A plugin whose manifest cannot be read is listed
 * with an `error` instead of breaking the rest.
 */
// what the host answers itself, so a plugin cannot be called that (`GET /api/plugins/enabled`, `/config.yml`, `/:id/settings`)
const RESERVED_IDS = ['enabled', 'config.yml', 'settings', 'install', 'enable', 'disable'];

export const readCatalog = async ({ pluginsDir, lineaVersion, hostApiVersion = '1.0.0', env = process.env }) => {
  const market = await readJsonIfAny(path.join(pluginsDir, 'marketplace.json'));
  const entries = Array.isArray(market) ? market : (market?.plugins ?? []);
  return Promise.all(entries.map(async (entry) => {
    const dir = path.resolve(pluginsDir, entry.path ?? entry.id);
    try {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(String(entry.id)) || RESERVED_IDS.includes(entry.id)) throw new Error(`"${entry.id}" cannot be the id of a plugin (lowercase letters, digits and dashes; not ${RESERVED_IDS.join(', ')})`);
      const manifest = await readJson(path.join(dir, 'plugin.json'));
      if (manifest.id !== entry.id) throw new Error(`plugin.json says "${manifest.id}", the catalog says "${entry.id}"`);
      const { errors, warnings } = validateManifest(manifest);
      if (errors.length) throw new Error(`plugin.json: ${errors.join('; ')}`);
      for (const warning of warnings) console.warn(`[plugins] ${entry.id}: plugin.json has ${warning}`);
      const requires = manifest.requires?.linea;
      if (manifest.remote) {
        manifest.remote = Object.fromEntries(Object.entries(manifest.remote).map(([key, value]) => [key, typeof value === 'string' ? expand(value, env) : value]));
      }
      return {
        ...entry,
        ...manifest,
        dir,
        // LINEA's own version, and the version of what a plugin is given (`ctx`, `ui`)
        compatible: (!requires || semver.satisfies(lineaVersion, requires, { includePrerelease: true }))
          && (!manifest.requires?.hostApi || semver.satisfies(hostApiVersion, manifest.requires.hostApi, { includePrerelease: true })),
      };
    } catch (error) {
      return { ...entry, dir, error: error.message, compatible: false };
    }
  }));
};
