import { describe, it, expect, afterEach } from 'vitest';
import { registriesOf, registryFor } from '../model/git/index.js';
import { featureMetamodelLocation } from '../model/services/modules/hosts.js';

const saved = { registry: process.env.LINEA_REGISTRY, metamodel: process.env.LINEA_FEATURE_METAMODEL };
const restore = (key, name) => (saved[key] === undefined ? delete process.env[name] : (process.env[name] = saved[key]));

describe('one registry per git host', () => {
  afterEach(() => {
    restore('registry', 'LINEA_REGISTRY');
    restore('metamodel', 'LINEA_FEATURE_METAMODEL');
  });

  it('is the one on the host the person works on, else the first there is', () => {
    process.env.LINEA_REGISTRY = 'local:registry/index, gitlab:linea/registry';
    expect(registriesOf()).toEqual(['local:registry/index', 'gitlab:linea/registry']);
    expect(registryFor('gitlab')).toBe('gitlab:linea/registry');
    expect(registryFor('local')).toBe('local:registry/index');
    expect(registryFor('github')).toBe('local:registry/index');
  });

  it('is none when there is none', () => {
    delete process.env.LINEA_REGISTRY;
    expect(registryFor('gitlab')).toBeNull();
  });

  it('has the feature metamodel of that host', () => {
    process.env.LINEA_REGISTRY = 'local:registry/index,gitlab:registry/index';
    process.env.LINEA_FEATURE_METAMODEL = 'local:registry/metamodels/featuremodel,gitlab:registry/metamodels/featuremodel';
    expect(featureMetamodelLocation('gitlab')).toBe('gitlab:registry/metamodels/featuremodel');
    expect(featureMetamodelLocation('local')).toBe('local:registry/metamodels/featuremodel');
  });
});
