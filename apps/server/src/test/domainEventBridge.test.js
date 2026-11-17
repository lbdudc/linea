import { createHmac } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The bridge adds who did it; no database here.
vi.mock('../model/entities/user.js', () => ({
  default: { findById: () => ({ select: () => ({ lean: () => Promise.resolve({ username: 'ana' }) }) }) },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

const EVENT_URL = 'http://receiver:3001/api/events';

const samplePayload = { productId: 'p1', lineId: 'l1', userId: 'u1', conflicts: false, stage: null, version: '1.0.1' };

let domainEvents;
let DOMAIN_EVENTS;
let wireDomainEventBridge;

beforeEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.EVENT_WEBHOOK_URLS;
  delete process.env.EVENT_WEBHOOK_SECRET;

  vi.resetModules();
  ({ default: domainEvents, DOMAIN_EVENTS } = await import('../model/events/domainEvents.js'));
  ({ wireDomainEventBridge } = await import('../model/events/domainEventBridge.js'));
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('wireDomainEventBridge', () => {
  it('POSTs PRODUCT_GENERATED signed in X-Linea-Signature with the payload and who did it when configured', async () => {
    process.env.EVENT_WEBHOOK_URLS = EVENT_URL;
    process.env.EVENT_WEBHOOK_SECRET = 's3cr3t';

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    globalThis.fetch = fetchMock;

    wireDomainEventBridge();
    domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, samplePayload);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(EVENT_URL);
    expect(init.method).toBe('POST');
    expect(init.headers['X-Linea-Signature']).toBe(`sha256=${createHmac('sha256', 's3cr3t').update(init.body).digest('hex')}`);
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ event: DOMAIN_EVENTS.PRODUCT_GENERATED, payload: { ...samplePayload, actor: { username: 'ana' } } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('forwards a push too, with the pusher as the actor', async () => {
    process.env.EVENT_WEBHOOK_URLS = EVENT_URL;
    process.env.EVENT_WEBHOOK_SECRET = 's3cr3t';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    globalThis.fetch = fetchMock;

    wireDomainEventBridge();
    domainEvents.emit(DOMAIN_EVENTS.GIT_PUSHED, { host: 'local', repositoryId: 7, username: 'bob' });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ event: DOMAIN_EVENTS.GIT_PUSHED, payload: { host: 'local', repositoryId: 7, username: 'bob', actor: { username: 'bob' } } });
  });

  it('forwards unconditionally — no conflicts-only filter, unlike domainSubscriber.js', async () => {
    process.env.EVENT_WEBHOOK_URLS = EVENT_URL;
    process.env.EVENT_WEBHOOK_SECRET = 's3cr3t';

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    globalThis.fetch = fetchMock;

    wireDomainEventBridge();
    domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, { ...samplePayload, conflicts: false });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never blocks the (synchronous) emit and never throws when the receiver is down — logs instead', async () => {
    process.env.EVENT_WEBHOOK_URLS = EVENT_URL;
    process.env.EVENT_WEBHOOK_SECRET = 's3cr3t';

    let rejectFetch;
    const pending = new Promise((_resolve, reject) => { rejectFetch = reject; });
    globalThis.fetch = vi.fn(() => pending);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    wireDomainEventBridge();

    const start = performance.now();
    expect(() => domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, samplePayload)).not.toThrow();
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(1000);

    rejectFetch(new Error('ECONNREFUSED'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errorSpy).toHaveBeenCalled();
  });

  it('caps the request at 5s via its own AbortSignal.timeout, never the 30s index.js gives an unsignalled fetch', async () => {
    process.env.EVENT_WEBHOOK_URLS = EVENT_URL;
    process.env.EVENT_WEBHOOK_SECRET = 's3cr3t';

    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    globalThis.fetch = fetchMock;

    wireDomainEventBridge();
    domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, samplePayload);
    await flush();

    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBe(timeoutSpy.mock.results[0].value);
  });

  it('is a no-op — zero fetch calls — when EVENT_WEBHOOK_URLS is unset', async () => {
    process.env.EVENT_WEBHOOK_SECRET = 's3cr3t';

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    wireDomainEventBridge();
    domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, samplePayload);
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is a no-op — zero fetch calls — when EVENT_WEBHOOK_SECRET is unset', async () => {
    process.env.EVENT_WEBHOOK_URLS = EVENT_URL;

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    wireDomainEventBridge();
    domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, samplePayload);
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is a no-op — zero fetch calls — when neither is set, and logs it exactly once, not per event', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    wireDomainEventBridge();
    domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, samplePayload);
    domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, samplePayload);
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: calling it twice only wires one listener', async () => {
    process.env.EVENT_WEBHOOK_URLS = EVENT_URL;
    process.env.EVENT_WEBHOOK_SECRET = 's3cr3t';

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    globalThis.fetch = fetchMock;

    wireDomainEventBridge();
    wireDomainEventBridge();
    domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, samplePayload);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends one signed POST per URL in the comma-separated list', async () => {
    process.env.EVENT_WEBHOOK_URLS = ' http://a/events , http://b/events ';
    process.env.EVENT_WEBHOOK_SECRET = 's3cr3t';

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    globalThis.fetch = fetchMock;

    wireDomainEventBridge();
    domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, samplePayload);
    await flush();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['http://a/events', 'http://b/events']);
  });
});

describe('wireDomainEventBridge with plugins', () => {
  it('also sends to the receivers of the plugins that are enabled when the event happens', async () => {
    process.env.EVENT_WEBHOOK_SECRET = 's3cr3t';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    globalThis.fetch = fetchMock;
    let targets = [];

    wireDomainEventBridge({ pluginTargets: () => targets });
    domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, samplePayload);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled(); // no receiver, nothing sent

    targets = ['http://agents:3001/api/events'];
    domainEvents.emit(DOMAIN_EVENTS.PRODUCT_GENERATED, samplePayload);
    await flush();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['http://agents:3001/api/events']);
  });
});
