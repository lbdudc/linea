import { describe, expect, it } from 'vitest';
import { healthOfReport } from '../model/services/modules/ModularService.js';

const error = (file, message, pkg = 'product') => ({ severity: 'error', package: pkg, file, message });

describe('healthOfReport: a product is healthy only when generating it would not fail its check', () => {
  it('is healthy when the check found no error (warnings do not count)', () => {
    const report = { diagnostics: [{ severity: 'warning', package: 'product', file: '.linea/models/basic.basic', message: 'w' }], models: { features: ['A'] } };

    expect(healthOfReport({ report })).toEqual({ valid: true, features: ['A'], error: null, errorType: null });
  });

  it('is not healthy for an error in the feature selection', () => {
    const report = { diagnostics: [error('.linea/models/featureselection.featureselection', 'choose one')] };

    expect(healthOfReport({ report })).toMatchObject({ valid: false, errorType: 'selection' });
  });

  it('is not healthy for an error in any other model of the product (generation fails on it too)', () => {
    const report = { diagnostics: [error('.linea/models/gismodel.gismodel', 'unknown layer')] };

    expect(healthOfReport({ report })).toMatchObject({ valid: false, errorType: 'models', error: '.linea/models/gismodel.gismodel: unknown layer' });
  });

  it('tells the SPL error before the selection one, and the selection one before the rest', () => {
    const spl = error(undefined, 'broken', 'spl');
    const selection = error('.linea/models/featureselection.featureselection', 'choose one');
    const other = error('.linea/models/gismodel.gismodel', 'unknown layer');

    expect(healthOfReport({ report: { diagnostics: [other, selection, spl] } }).errorType).toBe('model');
    expect(healthOfReport({ report: { diagnostics: [other, selection] } }).errorType).toBe('selection');
  });

  it('does not count the model of a metamodel the SPL lost: generating adapts it away', () => {
    const report = { diagnostics: [error('.linea/models/sensors', '"sensors" is not a metamodel of the products of this SPL.')] };

    expect(healthOfReport({ report }).valid).toBe(true);
  });

  it('falls back to the stored features when the check composed none', () => {
    expect(healthOfReport({ report: { diagnostics: [] }, fallbackFeatures: ['B'] }).features).toEqual(['B']);
  });
});
