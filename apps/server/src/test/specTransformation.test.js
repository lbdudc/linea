import { test, expect } from 'vitest';
import { runTransformation } from '../model/services/modules/transformation.js';

test('the data a transformation.js makes of a spec', () => {
  const code = 'module.exports = function (input) { return { features: input.features, data: { basicData: { name: input.basicData.name.toUpperCase() }, count: input.items.length } }; };';
  const spec = { basicData: { name: 'shop' }, items: [1, 2, 3], features: [] };
  expect(runTransformation({ code, spec })).toEqual({ basicData: { name: 'SHOP' }, count: 3 });
  expect(spec.basicData.name).toBe('shop');
});

test('a transformation runs on its own: no require, no process', () => {
  expect(() => runTransformation({ code: 'module.exports = function () { return { data: { p: typeof process, r: typeof require } }; };', spec: {} })).not.toThrow();
  expect(runTransformation({ code: 'module.exports = function () { return { data: { p: typeof process, r: typeof require } }; };', spec: {} })).toEqual({ p: 'undefined', r: 'undefined' });
});

test('a transformation that never ends, or exports no function, is an error', () => {
  expect(() => runTransformation({ code: 'module.exports = function () { while (true) {} };', spec: {}, timeoutMs: 50 })).toThrow(/timed out/);
  expect(() => runTransformation({ code: 'module.exports = 3;', spec: {} })).toThrow(/does not export a function/);
});

test('a transformation that gives no data gives nothing', () => {
  expect(runTransformation({ code: 'module.exports = function () { return { features: [] }; };', spec: {} })).toEqual({});
});
