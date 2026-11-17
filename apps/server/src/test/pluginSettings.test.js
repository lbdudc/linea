import { test, expect } from 'vitest';
import { resolveSettings, validateSettings, maskSecrets, publicSettings } from '../config/settings.js';

const schema = {
  url: { type: 'url', default: 'http://localhost:8000', env: 'SVC_URL' },
  limit: { type: 'number', default: 100, min: 1 },
  solver: { type: 'enum', options: ['sat', 'bdd'], default: 'sat', public: true },
  key: { type: 'secret', env: 'SVC_KEY', required: true },
  owners: { type: 'list' },
};

test('resolves default < env < stored < file, saying where each came from', () => {
  const { values, meta } = resolveSettings(schema, {
    env: { SVC_URL: 'http://env:1', SVC_KEY: 'k' },
    stored: { url: 'http://stored:2', limit: '50' },
    file: { url: 'http://file:3', owners: 'a, b' },
  });
  expect(values).toMatchObject({ url: 'http://file:3', limit: 50, solver: 'sat', key: 'k', owners: ['a', 'b'] });
  expect(meta.url).toEqual({ source: 'file', locked: true });
  expect(meta.limit).toEqual({ source: 'stored', locked: false });
  expect(meta.key.source).toBe('env');
});

test('a required setting nobody gave is reported missing', () => {
  const { values, meta } = resolveSettings(schema, { env: {} });
  expect(values.key).toBeUndefined();
  expect(meta.key).toMatchObject({ missing: true });
});

test('validates a patch: unknown keys, locked keys, numbers, enums, urls', () => {
  expect(validateSettings(schema, { limit: 5, solver: 'bdd', url: 'http://x' })).toEqual([]);
  expect(validateSettings(schema, { nope: 1 })).toHaveLength(1);
  expect(validateSettings(schema, { limit: 0 })).toHaveLength(1);
  expect(validateSettings(schema, { solver: 'z3' })).toHaveLength(1);
  expect(validateSettings(schema, { url: 'not a url' })).toHaveLength(1);
  expect(validateSettings(schema, { limit: 5 }, { locked: ['limit'] })).toHaveLength(1);
});

test('secrets are masked and only public settings go to the browser', () => {
  const values = { key: 'secret', solver: 'sat', limit: 3 };
  expect(maskSecrets(schema, values)).toEqual({ key: { isSet: true }, solver: 'sat', limit: 3 });
  expect(publicSettings(schema, values)).toEqual({ solver: 'sat' });
});
