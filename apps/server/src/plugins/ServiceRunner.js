import { execFile, spawn } from 'node:child_process';
import path from 'node:path';

const TIMEOUT_MS = 10 * 60_000; // a first start builds the image
const OUTPUT_TAIL = 2000; // characters of what a failed operation said that are kept for the UI

/** What a person can ask of a service (`#steps` says what each one is in `docker compose`). */
export const ACTIONS = ['start', 'stop', 'restart', 'rebuild', 'down'];

/** A second operation asked for while one runs on the same plugin. */
export class ServiceBusyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ServiceBusyError';
    this.code = 'PLUGIN_STATE'; // onError answers it as a 409
  }
}

/** A container name that is not one of the compose file's services (or a verb that is not one of ours). */
export class ServiceInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ServiceInputError';
    this.code = 'PLUGIN_SERVICE_INPUT'; // onError answers it as a 400
  }
}

/**
 * Starts, stops and watches the service a plugin runs in Docker (`service.compose` of its manifest: a compose file inside the plugin's
 * folder). It runs `docker compose` where it is, so it needs the Docker CLI and a daemon it can reach: this server in development, the
 * plugin runner (`apps/plugin-runner`) in a deployment, where this server has neither. When it cannot, that is said (`unavailable`) and
 * the plugin is left to be started by hand.
 *
 * `exec(args, { cwd, env })` runs the `docker` command and returns its stdout, and `follow(args, { cwd, env, onData, onEnd })` keeps one
 * running and returns what ends it: they are parameters so that tests need no Docker.
 */
const dockerExec = (args, { cwd, env }) => new Promise((resolve, reject) => {
  execFile('docker', args, { cwd, env, timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(new Error((stderr || error.message).trim().split('\n').slice(-3).join(' ')), { code: error.code }));
    else resolve(stdout);
  });
});

const dockerFollow = (args, { cwd, env, onData, onEnd }) => {
  const child = spawn('docker', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => onData(chunk.toString()));
  child.stderr.on('data', (chunk) => onData(chunk.toString()));
  child.on('error', (error) => onEnd(error.code === 'ENOENT' ? new Error('the Docker CLI is not installed here') : error));
  child.on('close', () => onEnd(null));
  return () => child.kill('SIGTERM');
};

export class ServiceRunner {
  #exec;
  #follow;
  #operations = new Map(); // plugin id -> { kind, service, startedAt, finishedAt, error, output }: the last one, running or not

  constructor({ exec = dockerExec, follow = dockerFollow } = {}) {
    this.#exec = exec;
    this.#follow = follow;
  }

  #args(plugin, ...rest) {
    return ['compose', '-p', plugin.service.project ?? `linea-${plugin.id}`, '-f', path.resolve(plugin.dir, plugin.service.compose), ...rest];
  }

  /** The names of the services of the compose file: the only containers a person can act on. */
  async services(plugin, env) {
    return (await this.#exec(this.#args(plugin, 'config', '--services'), { cwd: plugin.dir, env })).split('\n').map((line) => line.trim()).filter(Boolean);
  }

  async #checked(plugin, env, service) {
    if (service === null || service === undefined || service === '') return null;
    if (!(await this.services(plugin, env)).includes(service)) throw new ServiceInputError(`"${service}" is not a service of "${plugin.id}".`);
    return service;
  }

  /**
   * `running` (every container is up), `starting`, `degraded` (up, but one crashed or is unhealthy), `failed` (down, and one crashed),
   * `stopped`, or `unavailable` with `error` (no Docker CLI, no daemon, a broken file). `operation` is the last thing asked of it.
   */
  async status(plugin, env) {
    const operation = this.operation(plugin.id);
    try {
      const out = await this.#exec(this.#args(plugin, 'ps', '--all', '--format', 'json'), { cwd: plugin.dir, env });
      const containers = out.split('\n').filter(Boolean).map((line) => JSON.parse(line));
      const running = containers.filter((container) => container.State === 'running');
      // a container that did its job and exited well (the one that starts a replica set) is not a service that is down
      const oneShot = (container) => container.State === 'exited' && container.ExitCode === 0;
      // 137 and 143 are what `docker stop` leaves (the container was killed after its grace time, or asked to end): a stop, not a crash
      const stopped = (container) => container.State === 'exited' && [0, 137, 143].includes(container.ExitCode);
      const crashed = containers.filter((container) => container.State === 'dead' || (container.State === 'exited' && !stopped(container)) || container.Health === 'unhealthy');
      const coming = containers.filter((container) => ['created', 'restarting'].includes(container.State) || (container.State === 'running' && container.Health === 'starting'));
      const wanted = containers.filter((container) => !oneShot(container));
      const details = containers.map((container) => ({
        name: container.Name, service: container.Service, state: container.State, health: container.Health || null,
        exitCode: container.State === 'running' ? null : (container.ExitCode ?? null), status: container.Status ?? null,
        ports: (container.Publishers ?? []).filter((port) => port.PublishedPort).map((port) => `${port.PublishedPort}→${port.TargetPort}`).filter((port, i, all) => all.indexOf(port) === i),
      }));
      // running: all up; starting: something is coming up; degraded: up, but a container crashed or is unhealthy; failed: nothing up and one crashed
      const killed = containers.filter((container) => container.State === 'exited' && [137, 143].includes(container.ExitCode));
      const state = !running.length ? (crashed.length ? 'failed' : (coming.length ? 'starting' : 'stopped'))
        : (crashed.length || killed.length) ? 'degraded'
          : (coming.length || running.length < wanted.length) ? 'starting' : 'running';
      return { state, containers: running.length, total: wanted.length, details, error: null, operation };
    } catch (error) {
      return { state: 'unavailable', containers: 0, total: 0, details: [], error: error.code === 'ENOENT' ? 'the Docker CLI is not installed here' : error.message, operation };
    }
  }

  /** The last `tail` lines of every container of the service, with their time (what `docker compose logs` says). */
  async logs(plugin, env, { tail = 200, service = null } = {}) {
    return this.#exec(this.#args(plugin, 'logs', '--no-color', '--timestamps', '--tail', String(tail), ...(service ? [service] : [])), { cwd: plugin.dir, env });
  }

  /**
   * Keeps following the logs (`logs -f`): `onData(text)` for what comes, `onEnd(error|null)` once, and the returned function stops it.
   * A `service` that is not one of the compose file's is refused.
   */
  async followLogs(plugin, env, { tail = 200, service = null, onData, onEnd }) {
    const name = await this.#checked(plugin, env, service);
    return this.#follow(this.#args(plugin, 'logs', '-f', '--no-color', '--timestamps', '--tail', String(tail), ...(name ? [name] : [])), { cwd: plugin.dir, env, onData, onEnd });
  }

  /** The commands, in order, that make an action; `service` narrows it to one container of the compose file. */
  #steps(kind, service) {
    const only = service ? [service] : [];
    switch (kind) {
      case 'start': return [service ? ['start', service] : ['up', '-d', '--build', '--remove-orphans']];
      // `stop`, not `down`: the containers and their data stay for the next start
      case 'stop': return [['stop', ...only]];
      case 'restart': return [['restart', ...only]];
      // what the images say now (pulled where they are not built here), then every container made again
      case 'rebuild': return [['pull', '--ignore-buildable', '--quiet'], ['up', '-d', '--build', '--force-recreate', '--remove-orphans']];
      // the containers go, the volumes stay: a person's data is never what this removes
      case 'down': return [['down', '--remove-orphans']];
      default: throw new ServiceInputError(`"${kind}" is not something a service can be asked to do.`);
    }
  }

  /** What the last operation on a plugin was: `{ kind, service, startedAt, finishedAt, error, output }`, `null` when there was none. */
  operation(id) {
    const operation = this.#operations.get(id);
    return operation ? { ...operation } : null;
  }

  /** Checks the verb and the container, and takes the plugin's one place for an operation; the returned function does the work. */
  async #launch(plugin, env, kind, service) {
    const steps = this.#steps(kind, service);
    if (service && !['start', 'stop', 'restart'].includes(kind)) throw new ServiceInputError(`"${kind}" is for the whole service, not for one container.`);
    await this.#checked(plugin, env, service);
    // from here to the operation being set there is no await: two asks at once cannot both find the plugin free
    const current = this.#operations.get(plugin.id);
    if (current && !current.finishedAt) throw new ServiceBusyError(`The service of "${plugin.id}" is busy: ${current.kind} is running.`);
    const operation = { kind, service: service || null, startedAt: new Date().toISOString(), finishedAt: null, error: null, output: '' };
    this.#operations.set(plugin.id, operation);
    return async () => {
      try {
        for (const step of steps) operation.output = (operation.output + await this.#exec(this.#args(plugin, ...step), { cwd: plugin.dir, env })).slice(-OUTPUT_TAIL);
      } catch (error) {
        operation.error = error.message;
        throw error;
      } finally {
        operation.finishedAt = new Date().toISOString();
      }
    };
  }

  /**
   * Does `kind` (`start`, `stop`, `restart`, `rebuild`, `down`) on the service of a plugin, or on one container of it (`service`; only
   * start, stop and restart go to one). One operation at a time per plugin: another asked meanwhile is a `ServiceBusyError`.
   * Resolves when it is done and rejects with why it failed; the operation is kept for `status` either way.
   */
  async run(plugin, env, kind, service = null) {
    return (await this.#launch(plugin, env, kind, service))();
  }

  /** `run` without waiting: a refused verb, container or busy plugin is answered at once, how the rest ends is in `status().operation`. */
  async begin(plugin, env, kind, service = null) {
    const work = await this.#launch(plugin, env, kind, service);
    work().catch(() => {}); // it is in `operation.error`
  }

  start(plugin, env) { return this.run(plugin, env, 'start'); }

  stop(plugin, env) { return this.run(plugin, env, 'stop'); }
}
