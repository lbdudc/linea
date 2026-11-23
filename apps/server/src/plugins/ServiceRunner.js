import { execFile } from 'node:child_process';
import path from 'node:path';

const TIMEOUT_MS = 10 * 60_000; // a first start builds the image

/**
 * Starts and stops the service a plugin runs in Docker (`service.compose` of its manifest: a compose file inside the plugin's folder).
 * It runs `docker compose` where this server runs, so it needs the Docker CLI and a daemon it can reach; when it cannot, that is said
 * (`unavailable`) and the plugin is left to be started by hand.
 *
 * `exec(args, { cwd, env })` runs the `docker` command and returns its stdout; it is a parameter so that tests need no Docker.
 */
const dockerExec = (args, { cwd, env }) => new Promise((resolve, reject) => {
  execFile('docker', args, { cwd, env, timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(new Error((stderr || error.message).trim().split('\n').slice(-3).join(' ')), { code: error.code }));
    else resolve(stdout);
  });
});

export class ServiceRunner {
  #exec;

  constructor({ exec = dockerExec } = {}) {
    this.#exec = exec;
  }

  #args(plugin, ...rest) {
    return ['compose', '-p', plugin.service.project ?? `linea-${plugin.id}`, '-f', path.resolve(plugin.dir, plugin.service.compose), ...rest];
  }

  /**
   * `running` (every container is up), `starting`, `degraded` (up, but one crashed or is unhealthy), `failed` (down, and one crashed),
   * `stopped`, or `unavailable` with `error` (no Docker CLI, no daemon, a broken file).
   */
  async status(plugin, env) {
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
      return { state, containers: running.length, total: wanted.length, details, error: null };
    } catch (error) {
      return { state: 'unavailable', containers: 0, total: 0, details: [], error: error.code === 'ENOENT' ? 'the Docker CLI is not installed here' : error.message };
    }
  }

  /** The last `tail` lines of every container of the service, with their time (what `docker compose logs` says). */
  async logs(plugin, env, { tail = 200, service = null } = {}) {
    return this.#exec(this.#args(plugin, 'logs', '--no-color', '--timestamps', '--tail', String(tail), ...(service ? [service] : [])), { cwd: plugin.dir, env });
  }

  async start(plugin, env) {
    await this.#exec(this.#args(plugin, 'up', '-d', '--build'), { cwd: plugin.dir, env });
  }

  /** `stop`, not `down`: the containers and their data stay for the next start. */
  async stop(plugin, env) {
    await this.#exec(this.#args(plugin, 'stop'), { cwd: plugin.dir, env });
  }
}
