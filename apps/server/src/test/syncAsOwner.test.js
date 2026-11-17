import { describe, it, expect, vi } from 'vitest';
import { syncAsOwner } from '../model/services/scheduler/index.js';

describe('syncAsOwner', () => {
  it('renews the owner session before the sync runs', async () => {
    const order = [];
    const run = syncAsOwner({ renew: async () => { order.push('renew'); }, sync: async () => { order.push('sync'); return 'run'; } });
    await expect(run({ id: 'p', userId: 'u' })).resolves.toBe('run');
    expect(order).toEqual(['renew', 'sync']);
  });

  it('does not sync when the session cannot be renewed', async () => {
    const sync = vi.fn();
    const run = syncAsOwner({ renew: async () => { throw new Error('invalid_grant'); }, sync });
    await expect(run({ id: 'p', userId: 'u' })).rejects.toThrow('invalid_grant');
    expect(sync).not.toHaveBeenCalled();
  });
});
