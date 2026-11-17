import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { readCatalog } from './PluginRegistry.js';
import { toConfigYaml } from '../config/deployConfig.js';
import { resolveSettings, validateSettings, maskSecrets, publicSettings } from '../config/settings.js';
import { PluginDisabledError, PluginIncompatibleError, PluginNotFoundError, PluginStateError } from './errors.js';

const HEALTH_TIMEOUT_MS = 2000;
const REGISTER_TIMEOUT_MS = 15_000;

// the paths the server itself answers: a plugin cannot take them over with an alias
const CORE_PREFIXES = ['/api/users', '/api/lines', '/api/products', '/api/logs', '/api/migration', '/api/dashboard', '/api/packages', '/api/registry', '/api/settings', '/api/plugins'];

/** The version of what `ctx` and `ui` offer a plugin (`requires.hostApi` in a manifest is checked against it). */
export const HOST_API_VERSION = '1.0.0';

/**
 * Runs the plugins of a folder inside the server. What a plugin may touch is `ctx` (see `#contextFor`): it never imports the server's files.
 *
 * - Installed plugins with a `server` entry are imported once (at `start`, or when installed) and `register(ctx)` is called.
 * - Being enabled is a switch the host reads on every request and every event, so disabling needs no restart.
 * - A plugin that fails to load is kept in the list with its `error`; the others carry on, and it can be tried again.
 * - What a plugin registers (routes, event and settings listeners) takes effect only once its `register` has finished well; when it is
 *   uninstalled all of it goes (a reinstall loads the code on disk again).
 * - A plugin that needs a git host (`requires.gitHosts`) is off while none of them is on.
 */
// What stopped a plugin is shown to people in the Plugins view: the folders of this server stay in its log (`…/plugin/server/index.js` is enough to find it).
const withoutPaths = (message) => String(message ?? '').replace(/(?:file:\/\/)?(?:\/[\w.@+~-]+){3,}/g, (path) => `…/${path.split('/').slice(-3).join('/')}`);

export class PluginHost {
  #pluginsDir;
  #lineaVersion;
  #store;
  #services;
  #events;
  #fetch;
  #records = new Map(); // id -> { installed, enabled, ... } as stored
  #loaded = new Map(); // id -> { routers: [express.Router], error? }
  #catalog = [];
  #declared; // id -> { settings } from linea.config.yml: wins over what was set in the UI
  #env;
  #settingListeners = new Map(); // id -> [fn]
  #loadErrors = new Map(); // id -> message: what stopped a plugin from loading (it can be tried again)
  #loads = 0; // a counter for the address of the module, so that loading again reads the file again
  #enabledHosts;
  #registerTimeoutMs;

  constructor({ pluginsDir, lineaVersion, store, services = {}, events, fetchFn = globalThis.fetch, declared = {}, env = process.env, enabledHosts = null, registerTimeoutMs = REGISTER_TIMEOUT_MS }) {
    this.#enabledHosts = enabledHosts;
    this.#registerTimeoutMs = registerTimeoutMs;
    this.#declared = declared;
    this.#env = env;
    this.#pluginsDir = pluginsDir;
    this.#lineaVersion = lineaVersion;
    this.#store = store;
    this.#services = services;
    this.#events = events;
    this.#fetch = fetchFn;
  }

  /**
   * Loads the installed plugins. `provision` (ids, from `LINEA_PLUGINS`) are installed and enabled on the way when nobody has decided
   * anything about them yet: a deployment that cannot do without one (GitHub as the git host: nobody could sign in to switch it on)
   * says so there. A plugin that was installed, or switched off, by a person stays as they left it.
   */
  async start({ provision = [] } = {}) {
    await this.#refresh();
    await this.#applyDeclared();
    for (const id of provision) {
      const plugin = this.#catalog.find((candidate) => candidate.id === id);
      if (!plugin) {
        console.warn(`[plugins] LINEA_PLUGINS asks for "${id}", which is not in the catalog`);
        continue;
      }
      if (this.#records.has(id)) continue;
      if (plugin.error || !plugin.compatible) {
        console.warn(`[plugins] LINEA_PLUGINS asks for "${id}", which cannot be installed here${plugin.error ? `: ${plugin.error}` : ''}`);
        continue;
      }
      this.#records.set(id, await this.#store.save(id, { installed: true, enabled: true, version: plugin.version, installedAt: new Date() }));
      console.info(`[plugins] ${id} installed and enabled (LINEA_PLUGINS)`);
    }
    for (const plugin of this.#catalog) {
      if (!this.#records.get(plugin.id)?.installed || plugin.error) continue;
      // LINEA may have been upgraded since it was installed: what no longer fits is not run
      if (!plugin.compatible) {
        this.#loadErrors.set(plugin.id, `needs LINEA ${plugin.requires?.linea ?? ''} and the plugin interface ${plugin.requires?.hostApi ?? ''}; this is ${this.#lineaVersion} / ${HOST_API_VERSION}`.replace(/\s+/g, ' '));
        console.warn(`[plugins] ${plugin.id} is installed but does not fit this LINEA: not loaded`);
        continue;
      }
      await this.#load(plugin);
    }
  }

  /**
   * The plugins `linea.config.yml` declares are put in the state it says on every start (so they survive a wiped database), and are the
   * file's from then on: the Plugins view cannot change them.
   */
  async #applyDeclared() {
    for (const [id, want] of Object.entries(this.#declared)) {
      const plugin = this.#catalog.find((candidate) => candidate.id === id);
      if (!plugin) {
        console.warn(`[plugins] linea.config.yml declares "${id}", which is not in the catalog`);
        continue;
      }
      if (plugin.error || !plugin.compatible) {
        console.warn(`[plugins] linea.config.yml declares "${id}", which cannot be installed here${plugin.error ? `: ${plugin.error}` : ''}`);
        continue;
      }
      for (const problem of validateSettings(plugin.settings, want.settings)) console.warn(`[plugins] ${id}: ${problem}`);
      let enabled = want.enabled;
      const missing = enabled ? this.#missing(plugin) : [];
      if (missing.length) {
        console.warn(`[plugins] ${id} is declared enabled but needs these settings: ${missing.join(', ')}; left disabled`);
        enabled = false;
      }
      const record = this.#records.get(id);
      if (record?.installed && record.enabled === enabled) continue;
      this.#records.set(id, await this.#store.save(id, { installed: true, enabled, version: plugin.version, installedAt: record?.installedAt ?? new Date() }));
      console.info(`[plugins] ${id} ${enabled ? 'enabled' : 'installed, disabled'} (linea.config.yml)`);
    }
  }

  /** True for a plugin the config file declares: its state is the file's, not the Plugins view's. */
  isDeclared(id) {
    return Object.hasOwn(this.#declared, id);
  }

  #notDeclared(id) {
    if (this.isDeclared(id)) throw new PluginStateError(id, `The plugin "${id}" is declared in linea.config.yml: change it there.`);
  }

  async #refresh() {
    this.#catalog = await readCatalog({ pluginsDir: this.#pluginsDir, lineaVersion: this.#lineaVersion, hostApiVersion: HOST_API_VERSION });
    this.#records = new Map((await this.#store.all()).map((record) => [record.id, record]));
  }

  #resolved(plugin) {
    return resolveSettings(plugin.settings, { file: this.#declared[plugin.id]?.settings, stored: this.#records.get(plugin.id)?.settings, env: this.#env });
  }

  /** The required settings nobody gave: the plugin cannot be switched on until they are. */
  #missing(plugin) {
    return Object.entries(this.#resolved(plugin).meta).filter(([, meta]) => meta.missing).map(([key]) => key);
  }

  #find(id) {
    const plugin = this.#catalog.find((candidate) => candidate.id === id);
    if (!plugin) throw new PluginNotFoundError(id);
    return plugin;
  }

  /** Why a plugin cannot work with the git hosts that are on (it needs one of `requires.gitHosts`), or null. */
  hostProblem(plugin) {
    const wanted = plugin.requires?.gitHosts;
    const on = this.#enabledHosts?.();
    if (!wanted?.length || !on) return null;
    return wanted.some((host) => on.includes(host)) ? null : `needs one of these git hosts to be on: ${wanted.join(', ')} (on: ${on.join(', ')})`;
  }

  isEnabled(id) {
    const record = this.#records.get(id);
    if (!(record?.installed && record.enabled)) return false;
    const plugin = this.#catalog.find((candidate) => candidate.id === id);
    return !(plugin && this.hostProblem(plugin));
  }

  #contextFor(plugin) {
    const { id } = plugin;
    const enabled = () => this.isEnabled(id);
    const routers = [];
    const aliases = [];
    // listeners are kept apart until `register` has finished: a plugin that fails half way leaves nothing subscribed
    const staged = { events: [], settings: [] };
    return {
      id,
      dir: plugin.dir,
      isEnabled: enabled,
      /** The plugin's settings, resolved: default < env < set in the UI < linea.config.yml (see settings.js). */
      settings: () => this.#resolved(plugin).values,
      /** `fn(values)` is called after the settings of this plugin were saved from the UI. */
      onSettingsChange: (fn) => staged.settings.push(fn),
      /** A router mounted at `/api/plugins/<id>`. Requests reach it only while the plugin is enabled. */
      router: () => {
        const router = express.Router();
        routers.push(router);
        return router;
      },
      /**
       * Also serves `prefix` (`/api/...`, the path of something that used to be the base's) with this plugin's routes: a request to
       * `prefix/x` reaches the router as `base/x`. For callers outside the web client that cannot move. `prefix` can be a RegExp for
       * a path with parameters: then `base` is a function from the match to the path the router sees. Never a path the server answers.
       */
      alias: (prefix, base = '') => {
        if (typeof prefix === 'string' && CORE_PREFIXES.some((core) => prefix.replace(/\/$/, '') === core || core.startsWith(`${prefix.replace(/\/$/, '')}/`))) {
          throw new Error(`${id}: ${prefix} is a whole part of the server itself (a sub-path of it is fine), not for an alias`);
        }
        aliases.push(prefix instanceof RegExp ? { pattern: prefix, base } : { prefix: prefix.replace(/\/$/, ''), base });
      },
      /** Like `domainEvents.on`, but the listener is skipped while the plugin is disabled. */
      events: {
        on: (name, listener) => staged.events.push([name, (...args) => (enabled() ? listener(...args) : undefined)]),
      },
      services: this.#services,
      _routers: routers,
      _aliases: aliases,
      _staged: staged,
    };
  }

  async #load(plugin) {
    if (this.#loaded.has(plugin.id)) return;
    this.#loadErrors.delete(plugin.id);
    const entry = { routers: [], aliases: [], pluginId: plugin.id, version: plugin.version, events: [] };
    if (!plugin.server) {
      this.#loaded.set(plugin.id, entry);
      return;
    }
    try {
      // (a new address each time: the module of a plugin that was changed on disk, or that failed before, is read again)
      const module = await import(`${pathToFileURL(path.resolve(plugin.dir, plugin.server)).href}?load=${this.#loads += 1}`);
      const ctx = this.#contextFor(plugin);
      let timer;
      const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`register() did not finish in ${this.#registerTimeoutMs} ms`)), this.#registerTimeoutMs); });
      try {
        await Promise.race([(module.default ?? module).register(ctx), timeout]);
      } finally {
        clearTimeout(timer);
      }
      entry.routers = ctx._routers;
      entry.aliases = ctx._aliases;
      for (const [name, listener] of ctx._staged.events) {
        this.#events?.on(name, listener);
        entry.events.push([name, listener]);
      }
      this.#settingListeners.set(plugin.id, ctx._staged.settings);
      this.#loaded.set(plugin.id, entry);
    } catch (error) {
      // nothing it registered is kept, and it can be tried again (install, enable)
      this.#loadErrors.set(plugin.id, withoutPaths(error.message));
      console.error(`[plugins] ${plugin.id} failed to load:`, error);
    }
  }

  /** Takes away everything a plugin registered: its routes, aliases and listeners. */
  #unload(id) {
    const entry = this.#loaded.get(id);
    for (const [name, listener] of entry?.events ?? []) this.#events?.off?.(name, listener);
    this.#loaded.delete(id);
    this.#settingListeners.delete(id);
    this.#loadErrors.delete(id);
  }

  #run(entry, req, res, next) {
    if (!this.isEnabled(entry.pluginId)) return next(new PluginDisabledError(entry.pluginId));
    let index = 0;
    const step = (error) => {
      if (error || index >= entry.routers.length) return next(error);
      entry.routers[index++](req, res, step);
    };
    return step();
  }

  /** Express middleware for `/api/plugins/:id/*`: hands the request to the router(s) of that plugin. */
  dispatch = (req, res, next) => {
    const entry = this.#loaded.get(req.params.id);
    if (!entry || entry.routers.length === 0) return next();
    return this.#run(entry, req, res, next);
  };

  /** App-level middleware for the aliases plugins declared (`ctx.alias`): the old paths of what moved into a plugin. */
  aliases = (req, res, next) => {
    for (const entry of this.#loaded.values()) {
      for (const { prefix, pattern, base } of entry.aliases) {
        let rewritten = null;
        if (pattern) {
          const match = pattern.exec(req.path);
          if (match) rewritten = base(match) + req.url.slice(req.path.length);
        } else if (req.path === prefix || req.path.startsWith(`${prefix}/`)) {
          rewritten = base + req.url.slice(prefix.length) || '/';
        }
        if (rewritten === null) continue;
        const original = req.url;
        req.url = rewritten;
        return this.#run(entry, req, res, (error) => {
          req.url = original;
          next(error);
        });
      }
    }
    return next();
  };

  /** The plugin's `remote` with its `url` setting (when it has one) as the address: the UI can change where its service is. */
  #remote(plugin) {
    const remote = plugin.remote;
    const url = plugin.settings?.url ? this.#resolved(plugin).values.url?.replace(/\/+$/, '') : null;
    if (!remote || !url || !remote.baseUrl) return remote;
    const swap = (address) => (typeof address === 'string' && address.startsWith(remote.baseUrl) ? url + address.slice(remote.baseUrl.length) : address);
    return { ...remote, baseUrl: url, events: swap(remote.events), web: swap(remote.web) };
  }

  /**
   * Asks the service of a remote plugin (`remote.health`) and says what came back: `{ status: 'up' | 'down', latencyMs, httpStatus, error, checkedAt }`.
   * `null` for a plugin with no service to ask. `error` tells a refused connection, a timeout and an HTTP error apart.
   */
  async #probe(plugin) {
    const remote = this.#remote(plugin);
    if (!remote?.baseUrl || !remote.health) return null;
    const started = Date.now();
    const result = (status, extra = {}) => ({ status, latencyMs: Date.now() - started, httpStatus: null, error: null, checkedAt: new Date().toISOString(), ...extra });
    try {
      const response = await this.#fetch(new URL(remote.health, remote.baseUrl), { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      return response.ok ? result('up', { httpStatus: response.status }) : result('down', { httpStatus: response.status, error: `HTTP ${response.status}` });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      return result('down', { error: timedOut ? `no answer in ${HEALTH_TIMEOUT_MS} ms` : (error?.cause?.code ?? error?.cause?.errors?.[0]?.code ?? error?.message ?? 'unreachable') });
    }
  }

  /** The connectivity of one plugin: `{ id, inProcess, enabled, ...probe }`. A plugin with no service of its own is `status: 'n/a'`. */
  async health(id) {
    await this.#refresh();
    const plugin = this.#find(id);
    const probe = await this.#probe(plugin);
    return { id, inProcess: Boolean(plugin.server), enabled: this.isEnabled(id), ...(probe ?? { status: 'n/a', latencyMs: null, httpStatus: null, error: null, checkedAt: new Date().toISOString() }) };
  }

  /** The catalog with each plugin's state: what the Plugins view shows. */
  async list() {
    await this.#refresh();
    return Promise.all(this.#catalog.map(async (plugin) => {
      const record = this.#records.get(plugin.id);
      const { dir, server, ...shown } = plugin;
      if (plugin.remote) shown.remote = this.#remote(plugin);
      const probe = await this.#probe(plugin);
      return {
        ...shown,
        inProcess: Boolean(server),
        installed: Boolean(record?.installed),
        enabled: this.isEnabled(plugin.id),
        installedVersion: record?.version ?? null,
        loadError: this.#loadErrors.get(plugin.id) ?? null,
        // the code on disk is not the code that is running: a restart loads it
        restartRequired: Boolean(this.#loaded.get(plugin.id) && this.#loaded.get(plugin.id).version !== plugin.version),
        // it needs a git host that is not on
        unavailable: this.hostProblem(plugin),
        declared: this.isDeclared(plugin.id),
        settingsSchema: plugin.settings ?? null,
        settingsMissing: this.#missing(plugin),
        // declared in the file but left off: this says why (the log said it once)
        declaredOff: this.isDeclared(plugin.id) && !this.isEnabled(plugin.id) && Boolean(this.#missing(plugin).length) ? `declared but disabled: missing ${this.#missing(plugin).join(', ')}` : null,
        healthDetail: probe,
        health: probe?.status ?? null,
      };
    }));
  }

  /** What the web client loads: the enabled plugins and where their own web is, if they have one. */
  enabled() {
    return this.#catalog
      // one that failed to load is not offered to the web client: its pages would call a server half that is not there
      .filter((plugin) => this.isEnabled(plugin.id) && !this.#loadErrors.has(plugin.id))
      .map((plugin) => ({ id: plugin.id, version: plugin.version, client: Boolean(plugin.client), web: this.#remote(plugin)?.web ?? null, settings: publicSettings(plugin.settings, this.#resolved(plugin).values) }));
  }

  /** Where the enabled plugins want the domain events to be sent (`remote.events`). */
  eventUrls() {
    return this.#catalog.filter((plugin) => this.isEnabled(plugin.id) && plugin.remote?.events).map((plugin) => this.#remote(plugin).events);
  }

  async install(id) {
    this.#notDeclared(id);
    await this.#refresh();
    const plugin = this.#find(id);
    if (plugin.error) throw new PluginStateError(id, `The plugin "${id}" cannot be read: ${plugin.error}`);
    if (!plugin.compatible) throw new PluginIncompatibleError(id, plugin.requires?.linea, this.#lineaVersion);
    if (this.hostProblem(plugin)) throw new PluginStateError(id, `The plugin "${id}" ${this.hostProblem(plugin)}.`);
    // installing what is installed changes nothing (it does not switch it off)
    if (!this.#records.get(id)?.installed) {
      this.#records.set(id, await this.#store.save(id, { installed: true, enabled: false, version: plugin.version, installedAt: new Date() }));
    }
    await this.#load(plugin);
  }

  async setEnabled(id, enabled) {
    this.#notDeclared(id);
    await this.#refresh();
    const plugin = this.#find(id);
    if (!this.#records.get(id)?.installed) throw new PluginStateError(id, `The plugin "${id}" is not installed.`);
    if (enabled && this.hostProblem(plugin)) throw new PluginStateError(id, `The plugin "${id}" ${this.hostProblem(plugin)}.`);
    // one that failed to load gets another try before it is refused (a service that was down, a file that was fixed)
    if (enabled && !this.#loaded.has(id)) await this.#load(plugin);
    if (enabled && this.#loadErrors.get(id)) throw new PluginStateError(id, `The plugin "${id}" failed to load: ${this.#loadErrors.get(id)}`);
    const missing = enabled ? this.#missing(plugin) : [];
    if (missing.length) throw new PluginStateError(id, `The plugin "${id}" needs these settings first: ${missing.join(', ')}.`);
    this.#records.set(id, await this.#store.save(plugin.id, { enabled }));
  }

  /** The plugins and settings an admin chose, as the content of a `linea.config.yml` (secrets as `${PLUGIN_KEY}` placeholders). */
  async exportConfig({ gitHosts, instance } = {}) {
    await this.#refresh();
    const plugins = this.#catalog.filter((plugin) => this.#records.get(plugin.id)?.installed).map((plugin) => {
      const { values, meta } = this.#resolved(plugin);
      const settings = {};
      for (const [key, info] of Object.entries(meta)) {
        if (info.source !== 'file' && info.source !== 'stored') continue; // defaults and env are what the file would give anyway
        const secret = plugin.settings[key].type === 'secret';
        settings[key] = secret ? `\${${plugin.id.replace(/-plugin$/, '').toUpperCase().replace(/\W/g, '_')}_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}}` : values[key];
      }
      return { id: plugin.id, installed: true, enabled: this.isEnabled(plugin.id), settings };
    });
    return toConfigYaml({ plugins, gitHosts, instance });
  }

  /** The schema, the resolved values (secrets masked) and where each came from: what the settings dialog shows. */
  async getSettings(id) {
    await this.#refresh();
    const plugin = this.#find(id);
    const { values, meta } = this.#resolved(plugin);
    return { schema: plugin.settings ?? {}, values: maskSecrets(plugin.settings, values), meta };
  }

  /** Saves what was set in the UI (the keys of the file are refused) and tells the plugin. A secret sent empty keeps its value. */
  async saveSettings(id, patch) {
    await this.#refresh();
    const plugin = this.#find(id);
    const { values, meta } = this.#resolved(plugin);
    const locked = Object.keys(meta).filter((key) => meta[key].locked);
    const secret = (key) => plugin.settings?.[key]?.type === 'secret';
    // `{ clear: true }` forgets a secret, `null` any other setting (back to the environment's value, or the default)
    const cleared = Object.entries(patch ?? {}).filter(([key, value]) => (secret(key) && value?.clear === true) || (!secret(key) && value === null)).map(([key]) => key);
    const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([key, value]) => (secret(key) ? !(value === '' || value === null || value?.isSet !== undefined || value?.clear !== undefined) : value !== null)));
    const problems = validateSettings(plugin.settings, clean, { locked });
    if (problems.length) throw new PluginStateError(id, problems.join('; '));
    const stored = { ...(this.#records.get(id)?.settings ?? {}), ...clean };
    for (const key of cleared) delete stored[key];
    this.#records.set(id, await this.#store.save(id, { settings: stored }));
    const fresh = this.#resolved(plugin).values;
    // what is saved stays saved: a listener that fails is logged, it does not make the save a failure
    if (this.isEnabled(id)) {
      for (const fn of this.#settingListeners.get(id) ?? []) {
        try { await fn(fresh, values); } catch (error) { console.error(`[plugins] ${id}: onSettingsChange failed:`, error); }
      }
    }
    return this.getSettings(id);
  }

  async uninstall(id) {
    this.#notDeclared(id);
    await this.#refresh();
    this.#find(id);
    this.#records.set(id, await this.#store.save(id, { installed: false, enabled: false }));
    // everything it registered goes; installing it again loads the code that is on disk then
    this.#unload(id);
  }

  /** The keys the enabled plugins have for their service (the setting their manifest names in `serviceKey`): they act as that plugin. */
  serviceKeys() {
    return this.#catalog
      .filter((plugin) => plugin.serviceKey && this.isEnabled(plugin.id))
      .map((plugin) => ({ id: plugin.id, secret: this.#resolved(plugin).values[plugin.serviceKey], scopes: [] }))
      .filter((key) => key.secret);
  }
}
