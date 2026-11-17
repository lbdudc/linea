import { test, expect } from 'vitest';
import { validationResult } from 'express-validator';
import { updateProductValidator } from '../rest/validators/productValidators.js';

const basicData = { name: 'Product', version: '0.0.1' };

// runs every rule of the chain (the last item, the error handler, is left out) and reports whether the body passes
const rejects = async (spec) => {
  const req = { body: { spec }, headers: {}, params: {}, query: {} };
  for (const rule of updateProductValidator.slice(0, -1)) await rule.run(req);
  return !validationResult(req).isEmpty();
};

test('a spec of the right shape is accepted', async () => {
  expect(await rejects({ basicData, features: ['A'], statics: [], dataModel: { cells: [] } })).toBe(false);
  expect(await rejects({ basicData })).toBe(false);
});

// these used to be answered with 200 and stored as empty
test('features, statics and dataModel of another shape are refused', async () => {
  expect(await rejects({ basicData, features: 'Inventory' })).toBe(true);
  expect(await rejects({ basicData, features: [1, null] })).toBe(true);
  expect(await rejects({ basicData, statics: 'x' })).toBe(true);
  expect(await rejects({ basicData, dataModel: 'nope' })).toBe(true);
});
