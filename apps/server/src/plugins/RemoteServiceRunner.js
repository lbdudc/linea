import { ServiceBusyError, ServiceInputError } from './ServiceRunner.js';

// what the runner's own Docker needs is the runner's: it is not sent (the runner refuses it)
const RUNNERS_OWN = /^(PATH|HOME|USER|SHELL|LD_.*|DYLD_.*|DOCKER_.*|COMPOSE_.*|BUILDKIT_.*|NODE_.*)$/;
const forRunner = (env) => Object.fromEntries(Object.entries(env ?? {}).filter(([name, value]) => !RUNNERS_OWN.test(name) && typeof value === 'string'));

/**
 * The same as `ServiceRunner`, for a deployment whose server does not run Docker: it asks the plugin runner (`apps/plugin-runner`), the
 * one container that holds the Docker socket and the plugins' folders, to do it. Only a plugin's id, a container's name and the
 * environment its compose file is run with go over; the runner knows where the plugin and its compose file are.
 */
export class RemoteServiceRunner {
  #url;
  #key;
  #fetch;

  constructor({ url, key, fetchFn = globalThis.fetch }) {
    this.#url = url.replace(/\/+$/, '');
    this.#key = key;
    this.#fetch = fetchFn;
  }

  async #call(method, path, { body, signal } = {}) {
    const response = await this.#fetch(`${this.#url}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.#key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ?? AbortSignal.timeout(30_000),
    });
    if (response.ok) return response;
    const message = (await response.json().catch(() => ({}))).error ?? `the plugin runner answered ${response.status}`;
    if (response.status === 409) throw new ServiceBusyError(message);
    if (response.status === 400 || response.status === 404) throw new ServiceInputError(message);
    throw new Error(message);
  }

  async status(plugin, env) {
    try {
      return await (await this.#call('POST', `/plugins/${plugin.id}/status`, { body: { env: forRunner(env) } })).json();
    } catch (error) {
      return { state: 'unavailable', containers: 0, total: 0, details: [], error: `the plugin runner does not answer: ${error.message}`, operation: null };
    }
  }

  async logs(plugin, env, { tail = 200, service = null } = {}) {
    return (await this.#call('POST', `/plugins/${plugin.id}/logs`, { body: { env: forRunner(env), tail, service } })).text();
  }

  /** Reads `logs/stream` (server-sent events: one `data:` line of JSON text per chunk) until `stop` or the end. */
  async followLogs(plugin, env, { tail = 200, service = null, onData, onEnd }) {
    const controller = new AbortController();
    const response = await this.#call('POST', `/plugins/${plugin.id}/logs/stream`, { body: { env: forRunner(env), tail, service }, signal: controller.signal });
    (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            for (const line of event.split('\n')) if (line.startsWith('data: ')) onData(JSON.parse(line.slice(6)));
          }
        }
        onEnd(null);
      } catch (error) {
        onEnd(controller.signal.aborted ? null : error);
      }
    })();
    return () => controller.abort();
  }

  /** The runner does it in the background (a build takes minutes): this is asked and answered at once, `status().operation` follows it. */
  async begin(plugin, env, kind, service = null) {
    await this.#call('POST', `/plugins/${plugin.id}/${service ? `services/${encodeURIComponent(service)}/` : ''}${kind}`, { body: { env: forRunner(env) } });
  }

  run(plugin, env, kind, service = null) { return this.begin(plugin, env, kind, service); }

  start(plugin, env) { return this.begin(plugin, env, 'start'); }

  stop(plugin, env) { return this.begin(plugin, env, 'stop'); }
}
