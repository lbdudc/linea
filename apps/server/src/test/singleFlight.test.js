import { describe, it, expect } from 'vitest';
import { singleFlight } from '../model/services/singleFlight.js';

describe('singleFlight', () => {
  it('runs a task once for the calls that come while it runs, and gives them all its result', async () => {
    const once = singleFlight();
    let runs = 0;
    const task = async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'done';
    };
    const results = await Promise.all([once('a', task), once('a', task), once('a', task)]);
    expect(results).toEqual(['done', 'done', 'done']);
    expect(runs).toBe(1);
  });

  it('keeps different keys apart', async () => {
    const once = singleFlight();
    const results = await Promise.all([once('a', async () => 1), once('b', async () => 2)]);
    expect(results).toEqual([1, 2]);
  });

  it('runs again after the task is over, also when it failed', async () => {
    const once = singleFlight();
    await expect(once('a', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(once('a', async () => 'again')).resolves.toBe('again');
  });
});
