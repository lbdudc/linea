import { describe, it, expect } from 'vitest';
import { specHash, deploymentStatus, indexOnlySpec, fallbackSpecOf } from '../model/services/ProductSpecService.js';

describe('specHash', () => {
  it('does not depend on the order of the keys', () => {
    expect(specHash({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(specHash({ b: { d: [1, 2], c: 2 }, a: 1 }));
  });

  it('is the same for a spec and for what is read back from its file', () => {
    const spec = { basicData: { name: 'P', createdAt: new Date('2026-01-01T00:00:00Z') }, features: ['A'], gone: undefined };
    expect(specHash(spec)).toBe(specHash(JSON.parse(JSON.stringify(spec))));
  });

  it('changes when the content does', () => {
    expect(specHash({ features: ['A'] })).not.toBe(specHash({ features: ['A', 'B'] }));
  });
});

describe('deploymentStatus', () => {
  const spec = { basicData: { name: 'P', version: '1.0.0' }, features: ['A'] };

  it('is unknown without a record', () => {
    expect(deploymentStatus({ deployed: null, spec })).toEqual({ pending: null, version: null, deployedAt: null, restorable: false, modelsChanged: null });
  });

  it('is not pending when the saved spec is the one that was deployed', () => {
    const deployed = { specHash: specHash(spec), version: '1.0.0', deployedAt: 'x', spec };
    expect(deploymentStatus({ deployed, spec })).toMatchObject({ pending: false, restorable: true });
  });

  it('is pending once something else is saved, and can only be restored when the deployed spec was kept', () => {
    const changed = { ...spec, features: ['A', 'B'] };
    expect(deploymentStatus({ deployed: { specHash: specHash(spec), version: '1.0.0', spec }, spec: changed })).toMatchObject({ pending: true, restorable: true });
    expect(deploymentStatus({ deployed: { specHash: specHash(spec), version: '1.0.0' }, spec: changed })).toMatchObject({ pending: true, restorable: false });
  });
});

describe('deploymentStatus with the models of the product', () => {
  const spec = { basicData: { name: 'P', version: '1.0.0' }, features: ['A'] };
  const record = (models) => ({ specHash: specHash(spec), version: '1.0.0', spec, ...(models ? { models } : {}) });

  it('is pending when a model changed even if the spec did not', () => {
    const status = deploymentStatus({ deployed: record({ datamodel: 'a' }), spec, models: { datamodel: 'b' } });
    expect(status).toMatchObject({ pending: true, modelsChanged: true });
  });

  it('names the models that changed, and whether the spec did', () => {
    const deployed = record({ datamodel: 'a', gui: 'g', gone: 'x' });
    const status = deploymentStatus({ deployed, spec, models: { datamodel: 'b', gui: 'g', added: 'n' } });
    expect(status).toMatchObject({ changedModels: ['added', 'datamodel', 'gone'], specChanged: false });
    expect(deploymentStatus({ deployed, spec: { ...spec, features: ['A', 'B'] }, models: { datamodel: 'a', gui: 'g', gone: 'x' } })).toMatchObject({ changedModels: [], specChanged: true });
  });

  it('does not count a different line ending as a change', () => {
    expect(deploymentStatus({ deployed: record({ basic: 'basic x\n' }), spec, models: { basic: 'basic x\r\n' } })).toMatchObject({ pending: false, modelsChanged: false, changedModels: [] });
  });

  it('is not pending when the models are the ones that were generated', () => {
    const status = deploymentStatus({ deployed: record({ datamodel: 'a' }), spec, models: { datamodel: 'a' } });
    expect(status).toMatchObject({ pending: false, modelsChanged: false });
  });

  it('leaves the models out when the record did not keep them or they are not known', () => {
    expect(deploymentStatus({ deployed: record(null), spec, models: { datamodel: 'b' } })).toMatchObject({ pending: false, modelsChanged: null });
    expect(deploymentStatus({ deployed: record({ datamodel: 'a' }), spec, models: undefined })).toMatchObject({ pending: false, modelsChanged: null });
  });
});

describe('what Mongo keeps of a product', () => {
  it('is an index: name, version and no configuration', () => {
    const index = indexOnlySpec({ basicData: { name: 'P', version: '1.2.3', database: { x: 1 } }, features: ['A'], statics: [{}], dataModel: { cells: [{}] } });
    expect(index.basicData).toMatchObject({ name: 'P', version: '1.2.3', database: {} });
    expect(index.features).toEqual([]);
    expect(index.statics).toEqual([]);
    expect(index.dataModel.cells).toEqual([]);
  });

  it('is no stand-in for the spec once the product lives in GitLab', () => {
    expect(fallbackSpecOf({ specInRepo: true, spec: { features: [] } })).toBeNull();
    expect(fallbackSpecOf({ specInRepo: false, spec: { features: ['A'] } })).toEqual({ features: ['A'] });
  });
});
