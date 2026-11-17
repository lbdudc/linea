import { describe, expect, it } from 'vitest';
import { originOf } from '../model/services/MergeRequestService.js';
import { properties } from '../model/connectors/properties.js';

describe('originOf', () => {
  it('tells a sync from a generation although both come from the base branch', () => {
    const base = properties.git.baseBranch;

    expect(originOf({ sourceBranch: base, title: 'Sync with SPL v1.2.0 (product v0.0.1)' })).toBe('sync');
    expect(originOf({ sourceBranch: base, title: 'Update to product version: 0.0.2' })).toBe('generation');
  });

  it('knows the branches a sync makes, and a request a person opened', () => {
    expect(originOf({ sourceBranch: 'sync/20261110T1212', title: 'whatever' })).toBe('sync');
    expect(originOf({ sourceBranch: 'feature/x', title: 'Add x' })).toBe('manual');
  });
});
