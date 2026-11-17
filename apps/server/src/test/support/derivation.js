import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFsFiles,
  createFsPackageSource,
  parseSplManifest,
  resolveSpl,
  selectionText,
  FEATURE_SELECTION_GRAMMAR,
} from '@lbdudc/linea-core';

// the metamodels repository (linea-metamodels, next to this checkout, or LINEA_METAMODELS_DIR): the feature metamodel every SPL has is
// the one that lives in it (`metamodels/featuremodel`)
const WORKSPACE = process.env.LINEA_METAMODELS_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../linea-metamodels');

/**
 * What `runEngine` is given to derive a product of the line in `lineOutput`: the SPL resolved (its feature metamodel read from the
 * workspace on disk, not from a git host), and the product's feature selection as its model.
 */
export async function modularOf({ lineOutput, features }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(lineOutput, 'spl.json'), 'utf8'));
  const spl = parseSplManifest({ content: JSON.stringify({ ...manifest, metamodels: { 'file:metamodels/featuremodel': '^1.0.0' } }) });
  const resolved = await resolveSpl({ spl, source: createFsPackageSource({ root: WORKSPACE }) });
  return {
    resolved,
    spl: createFsFiles({ dir: lineOutput }),
    models: { [FEATURE_SELECTION_GRAMMAR]: selectionText({ model: manifest.name === 'GEMA' ? 'GEMA_SPL' : manifest.name, features }) },
  };
}
