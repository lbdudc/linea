import { Bango } from '@lbdudc/bango';
import { configureWorkspace } from '@lbdudc/linea-core/workspace';
import type { MetamodelEngine } from '@lbdudc/linea-core';
import { packageSourceOf } from './git.js';

/**
 * The workspace (SPLs, products, modules and metamodels as folders) is linea-core's. What it is given here: bango as its metamodel
 * engine, and the git host's packages behind the folders' own, so a local SPL can use `gitlab:…` modules.
 */
configureWorkspace({ createEngine: () => new Bango() as unknown as MetamodelEngine, sourceOf: (folders) => packageSourceOf(folders) });

export * from '@lbdudc/linea-core/workspace';
