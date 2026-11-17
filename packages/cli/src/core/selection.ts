import fs from 'node:fs';
import path from 'node:path';
import { selectionText } from '@lbdudc/linea-core';
import { readLocalModelAsUvl } from './workspace.js';

const GROUPS = new Set(['mandatory', 'optional', 'or', 'alternative']);

/** The features of a composed feature model (UVL), root first, in the order of the file. */
export function featureNamesOf(uvl: string): string[] {
  const names: string[] = [];
  for (const line of uvl.replace(/\r\n/g, '\n').split('\n')) {
    const text = line.trim();
    if (text === '' || text.startsWith('//')) continue;
    if (!line.startsWith('\t') && !line.startsWith(' ')) {
      if (text.toLowerCase() === 'constraints') break;
      continue; // `features`
    }
    const word = text.split(/\s+/)[0] ?? '';
    if (GROUPS.has(word) || /^\[/.test(text)) continue;
    names.push(word);
  }
  return names;
}

/** Where a product keeps its feature selection: a model of the feature metamodel. */
export const selectionPathOf = (productDir: string): string => path.join(productDir, '.linea', 'models', 'featureselection.featureselection');

/** The features the SPL's feature model does not have, among `wanted` (the composed model is what products choose from). */
export function unknownFeatures(lineDir: string, wanted: readonly string[]): string[] {
  const known = new Set(featureNamesOf(readLocalModelAsUvl(lineDir)));
  return wanted.filter((feature) => !known.has(feature));
}

/**
 * Writes the selection model of a product from the features of its spec (the root is always in; what the SPL asks of every product is
 * what the starting selection already has, so those are kept). A product that has no selection model yet (a plain SPL's) is left alone.
 */
export function writeProductSelection(lineDir: string, productDir: string, features: readonly string[]): void {
  const file = selectionPathOf(productDir);
  if (!fs.existsSync(file)) return;
  const names = featureNamesOf(readLocalModelAsUvl(lineDir));
  const root = names[0];
  if (!root) return;
  const current = [...fs.readFileSync(file, 'utf8').matchAll(/^\s*select\s+(\S+)/gm)].map((m) => m[1] as string);
  const chosen = [...new Set([...current, ...features])].filter((feature) => feature !== root);
  fs.writeFileSync(file, selectionText({ model: root, features: chosen }));
}

/** Takes features out of the selection model (the ones the SPL asks of every product come back with the next check). */
export function removeFromProductSelection(lineDir: string, productDir: string, removed: readonly string[]): void {
  const file = selectionPathOf(productDir);
  if (!fs.existsSync(file)) return;
  const root = featureNamesOf(readLocalModelAsUvl(lineDir))[0];
  if (!root) return;
  const current = [...fs.readFileSync(file, 'utf8').matchAll(/^\s*select\s+(\S+)/gm)].map((m) => m[1] as string);
  fs.writeFileSync(file, selectionText({ model: root, features: current.filter((feature) => !removed.includes(feature)) }));
}
