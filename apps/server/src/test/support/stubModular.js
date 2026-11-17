import { vi } from 'vitest';
import { Container } from 'typedi';
import { buildLineScaffold } from '@lbdudc/linea-core';
import ModularService from '../../model/services/modules/ModularService.js';
import { modularOf } from './derivation.js';

export const EMPTY_LOCK = { lockVersion: 1, packages: {} };

/**
 * What creating a line commits when nothing is resolved: the scaffold of `buildLineScaffold` (the manifest, the feature model, the platform)
 * with an empty lock. For the suites that mock the git host call by call and have no registry to resolve the feature metamodel from.
 */
export function scaffoldOf({ name, kind = 'plain', metamodels = {}, modules = {}, ci = 'gitlab' }) {
  return buildLineScaffold({ name, kind, metamodels, modules, featureMetamodel: 'gitlab:linea/metamodels/featuremodel', ci });
}

/**
 * Makes `previewLine` answer with that scaffold, `seedModels` have nothing to seed, and `prepareDerivation` resolve the SPL of the line it is
 * given from the workspace on disk (with the product's features as its selection), on the one `ModularService` the services share.
 */
/** `features`: the selection the products are derived with, when it is not the one in their spec (the products here have no models of their own). */
export function stubModular({ features } = {}) {
  const modular = Container.get(ModularService);
  vi.spyOn(modular, 'previewLine').mockImplementation(async ({ name, kind = 'plain', metamodels = {}, modules = {}, ci = 'gitlab' }) => ({
    ok: true,
    diagnostics: [],
    packages: [],
    lock: EMPTY_LOCK,
    files: scaffoldOf({ name, kind, metamodels, modules, ci }),
  }));
  vi.spyOn(modular, 'seedModels').mockResolvedValue(false);
  vi.spyOn(modular, 'prepareDerivation').mockImplementation(async ({ product, lineOutput }) => modularOf({ lineOutput, features: features ?? product.spec.features }));
  return modular;
}
