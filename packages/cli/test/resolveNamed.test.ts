import { describe, it, expect } from 'bun:test';
import { resolveNamed } from '../src/commands/util.js';

const items = [
  { id: 'aaa111', name: 'Alpha' },
  { id: 'bbb222', name: 'Beta' },
  { id: 'ccc333', name: 'beta' }, // same name, different case → duplicate
];

describe('resolveNamed', () => {
  it('resolves a 1-based list position', () => {
    expect(resolveNamed(items, '1', 'product')).toEqual({ id: 'aaa111' });
    expect(resolveNamed(items, '2', 'product')).toEqual({ id: 'bbb222' });
  });

  it('reports an out-of-range position', () => {
    expect(resolveNamed(items, '9', 'product')).toEqual({ error: 'No product #9.' });
  });

  it('resolves an exact id', () => {
    expect(resolveNamed(items, 'ccc333', 'product')).toEqual({ id: 'ccc333' });
  });

  it('resolves a unique name case-insensitively', () => {
    expect(resolveNamed(items, 'alpha', 'product')).toEqual({ id: 'aaa111' });
  });

  it('reports no match by name', () => {
    expect(resolveNamed(items, 'Gamma', 'SPL')).toEqual({ error: 'No SPL matching "Gamma".' });
  });

  it('reports ambiguous duplicate names instead of silently picking one', () => {
    expect(resolveNamed(items, 'Beta', 'SPL')).toEqual({
      error: 'Multiple SPLs named "Beta" — use its number or id.',
    });
  });
});
