import { test, expect, vi } from 'vitest';
import { createRecent, mapLimit } from '../model/services/recent.js';

test('callers that arrive together share one computation, and a later one gets the kept answer', async () => {
  const recent = createRecent({ ttlMs: 1000 });
  const load = vi.fn(async () => 'answer');
  const [a, b] = await Promise.all([recent.get('k', load), recent.get('k', load)]);
  expect([a, b]).toEqual(['answer', 'answer']);
  await recent.get('k', load);
  expect(load).toHaveBeenCalledTimes(1);
});

test('asks again after the time-to-live, and not after a failure', async () => {
  vi.useFakeTimers();
  try {
    const recent = createRecent({ ttlMs: 1000 });
    const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok');
    await expect(recent.get('k', load)).rejects.toThrow('boom');
    expect(await recent.get('k', load)).toBe('ok');
    vi.advanceTimersByTime(1001);
    await recent.get('k', load);
    expect(load).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

test('forget drops what matches', async () => {
  const recent = createRecent({ ttlMs: 1000 });
  const load = vi.fn(async () => 1);
  await recent.get('health|u|p1', load);
  await recent.get('health|u|p2', load);
  recent.forget((key) => key.endsWith('|p1'));
  await recent.get('health|u|p1', load);
  await recent.get('health|u|p2', load);
  expect(load).toHaveBeenCalledTimes(3);
});

test('mapLimit keeps the order and does not run more than the limit at once', async () => {
  let running = 0;
  let peak = 0;
  const results = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
    return n * 10;
  });
  expect(results).toEqual([10, 20, 30, 40, 50, 60]);
  expect(peak).toBe(2);
});

test('with staleMs an old answer is given at once while a new one is worked out, and forget beats it', async () => {
  vi.useFakeTimers();
  try {
    const recent = createRecent({ ttlMs: 1000, staleMs: 5000 });
    let version = 0;
    const load = vi.fn(async () => ++version);
    expect(await recent.get('k', load)).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(await recent.get('k', load)).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    expect(await recent.get('k', load)).toBe(2);
    vi.advanceTimersByTime(2000);
    expect(await recent.get('k', load)).toBe(2);
    recent.forget(() => true);
    expect(await recent.get('k', load)).toBe(4);
    vi.advanceTimersByTime(7000);
    expect(await recent.get('k', load)).toBe(5);
  } finally {
    vi.useRealTimers();
  }
});

test('an answer that arrives for a forgotten key is thrown away', async () => {
  vi.useFakeTimers();
  try {
    const recent = createRecent({ ttlMs: 1000, staleMs: 5000 });
    let release;
    const load = vi.fn()
      .mockResolvedValueOnce('old')
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValue('new');
    await recent.get('k', load);
    vi.advanceTimersByTime(2000);
    expect(await recent.get('k', load)).toBe('old');
    await vi.advanceTimersByTimeAsync(0);
    recent.forget(() => true);
    release('late');
    await vi.advanceTimersByTimeAsync(0);
    expect(await recent.get('k', load)).toBe('new');
  } finally {
    vi.useRealTimers();
  }
});

test('a refresh that fails keeps the old answer for the next ask', async () => {
  vi.useFakeTimers();
  try {
    const recent = createRecent({ ttlMs: 1000, staleMs: 5000 });
    const load = vi.fn().mockResolvedValueOnce('old').mockRejectedValueOnce(new Error('boom')).mockResolvedValue('new');
    await recent.get('k', load);
    vi.advanceTimersByTime(2000);
    expect(await recent.get('k', load)).toBe('old');
    await vi.advanceTimersByTimeAsync(0);
    expect(await recent.get('k', load)).toBe('old');
    await vi.advanceTimersByTimeAsync(0);
    expect(await recent.get('k', load)).toBe('new');
  } finally {
    vi.useRealTimers();
  }
});
