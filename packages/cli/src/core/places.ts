import path from 'node:path';
import { findContext } from './context.js';
import { listLocalLines, listLocalProducts, localProductDir } from './workspace.js';
import { listLocalPackages } from './workspace.js';

/**
 * Where `cd` can go, by name: the products of the SPL you are in, the SPLs of your workspace, and its modules and metamodels. A
 * name is what people know things by, not the path they happen to be at.
 */

export interface Place {
  name: string;
  dir: string;
  kind: 'product' | 'SPL' | 'module' | 'metamodel';
  /** for a product: the SPL it is in */
  of?: string;
}

/** In the order a name is looked for: what is in the SPL you are in comes before what is anywhere in the workspace. */
export function placesFrom(cwd: string, workdir: string): Place[] {
  const folder = findContext(cwd);
  const root = folder.workspace ?? workdir;
  const places: Place[] = [];
  if (folder.line) {
    for (const p of listLocalProducts(folder.line.dir)) {
      places.push({ name: p.name, dir: localProductDir(folder.line.dir, p.name), kind: 'product', of: folder.line.name });
    }
  }
  for (const l of listLocalLines(root)) places.push({ name: l.name, dir: l.dir, kind: 'SPL' });
  for (const p of listLocalPackages(root)) places.push({ name: p.name, dir: p.dir, kind: p.kind });
  return places;
}

/** The place with this name (case does not matter): the first of the order above. */
export function findPlace(places: readonly Place[], name: string): Place | undefined {
  const wanted = name.toLowerCase();
  return places.find((p) => p.name.toLowerCase() === wanted);
}

/** What a place is, for a hint: `product of gis`, `SPL`, `module`. */
export const describePlace = (p: Place): string => (p.kind === 'product' ? `product of ${p.of}` : p.kind);

/** The folder one level up (`cd ..`): from a product its SPL, from an SPL or a package its workspace. */
export const parentOf = (dir: string): string => path.dirname(dir);
