import { splalm } from './client.js';
import { gitSettings, remotePackages } from './git.js';
import type { SplalmLineSummary } from './types.js';

/**
 * The names of the SPLs LINEA has for you, for completing `get`. Completion is synchronous and the list is on the server, so it is
 * asked for in the background the first time it is wanted, kept for a while, and used as it is when it arrives. Failing to get it only
 * means nothing is offered: a prompt must never be slower or noisier for it.
 */

const FRESH_MS = 30_000;
let names: string[] = [];
/** the same SPLs with where their repository is, for the side panel */
let summaries: SplalmLineSummary[] = [];
let fetchedAt = 0;
let pending: Promise<string[]> | undefined;

/** What was last fetched (possibly nothing yet). */
export const remoteSplNames = (): readonly string[] => names;

/** The SPLs LINEA has, with the address of each one's repository (possibly nothing yet). */
export const remoteSplSummaries = (): readonly SplalmLineSummary[] => summaries;

/** Asks for the names again unless they are fresh; resolves with them. Never rejects. */
export function refreshRemoteSplNames(now = Date.now()): Promise<string[]> {
  if (pending) return pending;
  if (names.length && now - fetchedAt < FRESH_MS) return Promise.resolve(names);
  pending = (async () => {
    try {
      summaries = (await splalm.get('/api/lines/enrolled')) as SplalmLineSummary[];
      names = summaries.map((l) => l.name);
      fetchedAt = Date.now();
    } catch {
      /* nothing to offer */
    }
    pending = undefined;
    return names;
  })();
  return pending;
}

/** For tests, and for a sign-out: forget what was fetched. */
export function forgetRemoteSplNames(): void {
  names = [];
  summaries = [];
  fetchedAt = 0;
  pending = undefined;
  catalog = { modules: [], metamodels: [] };
  catalogAt = 0;
  catalogPending = undefined;
}

/** The modules and metamodels on the git host, by name (what the side panel shows next to those of the workspace). */
export interface RemoteCatalog {
  modules: { name: string; location: string }[];
  metamodels: { name: string; location: string }[];
}

let catalog: RemoteCatalog = { modules: [], metamodels: [] };
let catalogAt = 0;
let catalogPending: Promise<RemoteCatalog> | undefined;

/** What was last fetched (possibly nothing yet). */
export const remoteCatalog = (): RemoteCatalog => catalog;

/**
 * Asks the git host for its modules and metamodels, and LINEA for the SPLs, unless they are fresh (`force` skips that: a login
 * has just changed who is asking). Never rejects: a host that cannot be reached or a missing token only leaves the panel as it was.
 */
export function refreshRemoteCatalog({ force = false, now = Date.now() }: { force?: boolean; now?: number } = {}): Promise<RemoteCatalog> {
  if (catalogPending) return catalogPending;
  if (!force && (catalog.modules.length || catalog.metamodels.length) && now - catalogAt < FRESH_MS) return Promise.resolve(catalog);
  catalogPending = (async () => {
    const lines = force ? (forgetNames(), refreshRemoteSplNames()) : refreshRemoteSplNames(now);
    try {
      const settings = gitSettings();
      const [modules, metamodels] = await Promise.all([
        remotePackages({ settings, kind: 'module' }),
        remotePackages({ settings, kind: 'metamodel' }),
      ]);
      const sorted = (found: { name: string; location: string }[]) =>
        [...new Map(found.map((p) => [p.name, { name: p.name, location: p.location }])).values()].sort((a, b) => a.name.localeCompare(b.name));
      catalog = { modules: sorted(modules), metamodels: sorted(metamodels) };
      catalogAt = Date.now();
    } catch {
      /* nothing to show */
    }
    await lines;
    catalogPending = undefined;
    return catalog;
  })();
  return catalogPending;
}

function forgetNames(): void {
  names = [];
  summaries = [];
  fetchedAt = 0;
  pending = undefined;
}
