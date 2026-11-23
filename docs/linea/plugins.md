# Writing a LINEA plugin

This is the contract between LINEA and a plugin. The code that enforces it is `server/src/plugins/` (the host), `client/src/plugins/` (the web side) and `server/src/test/boundary.test.js`. Two working plugins that follow it are in [`docs/linea/plugin-examples/`](plugin-examples), and [`sdk/`](../../sdk) (package `linea-plugin-sdk`, no dependencies, not yet published) holds helpers for the parts a plugin would otherwise write itself. Until it is published, copy `sdk/index.js` into the plugin's service: a relative import out of the plugin's folder breaks once the plugin is moved into `PLUGINS_DIR`.

- [1. Two kinds of plugin](#1-two-kinds-of-plugin)
- [2. The plugins folder and `marketplace.json`](#2-the-plugins-folder-and-marketplacejson)
- [3. `plugin.json`](#3-pluginjson)
- [4. Settings](#4-settings)
- [5. Lifecycle](#5-lifecycle)
- [6. The server side: `register(ctx)`](#6-the-server-side-registerctx)
- [7. The web side: `register(ui)`](#7-the-web-side-registerui)
- [8. Remote plugins: the service contract](#8-remote-plugins-the-service-contract)
  - [8.1 A service that runs in Docker](#81-a-service-that-runs-in-docker)
- [9. Connectivity and health](#9-connectivity-and-health)
- [10. Rules the tests enforce](#10-rules-the-tests-enforce)
- [11. Versioning](#11-versioning)
- [12. Using plugins from the web UI and from linea-cli](#12-using-plugins-from-the-web-ui-and-from-linea-cli)

## 1. Two kinds of plugin

| | In-process | Remote |
|---|---|---|
| Runs | Inside the LINEA server, as a module | As its own HTTP service (any language) |
| Manifest | has `server` | has `remote` |
| Talks to LINEA | through `ctx` (routes, events, settings, `ctx.services`) | over HTTP: `Authorization: Service <key>` + `X-Act-As: <username>` |
| LINEA talks to it | calls its listeners | `GET remote.health`, `POST remote.events` |

A plugin may have both, and either may also have a `client` entry: code for the web interface (pages, menu entries, slots). A plugin with none of `server`, `client`, `remote` is valid but does nothing.

## 2. The plugins folder and `marketplace.json`

The server reads a folder: `PLUGINS_DIR`, or `plugins/` next to the `linea/` checkout. `PLUGINS_DIR` does **not** reach the web side: the client build globs `../../../../plugins/*/client/index.js` (`client/src/plugins/host.js`), the `plugins/` folder next to the checkout, at build time. So a plugin with a `client` entry must be in (or symlinked into) that folder when the client is built.

```
plugins/
├── marketplace.json          the catalog
└── my-plugin/
    ├── plugin.json           the manifest
    ├── server/index.js       default export { register(ctx) }       (in-process)
    ├── client/index.js       default export { register(ui) }        (web side)
    └── service/              a remote plugin's own service (optional place for it)
```

`marketplace.json` is `{ "plugins": [{ "id": "my-plugin", "path": "my-plugin" }] }`. `path` is relative to the folder and defaults to `id`. Anything else in an entry is a default that `plugin.json` overrides. Every folder with a manifest must be in the catalog and the reverse. The catalog of the official plugins is the `marketplace.json` of [`lbdudc/linea-plugins`](https://github.com/lbdudc/linea-plugins), where each plugin is a folder. A deployment points `PLUGINS_DIR` at a folder with its own catalog and plugin folders.

## 3. `plugin.json`

The schema is [`plugin.schema.json`](plugin.schema.json), for editors: it is stricter than the host (unknown keys are errors there, warnings in the host). `server/src/plugins/manifest.js` is what checks a manifest. A manifest with an **error** is listed in the Plugins view with the message and cannot be installed. An unknown key is only a **warning** in the server log (it is probably a typo).

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | `^[a-z0-9][a-z0-9-]*$`, equal to the catalog's `id`. Not `enabled`, `config.yml`, `settings`, `install`, `enable`, `disable` (the host answers those). Convention: ends in `-plugin` (not required: a plugin is a folder with a `plugin.json`) |
| `name` | yes | Text, or `{ "en": …, "es": …, "gl": … }` |
| `version` | yes | Semver. A new version on disk is loaded at the next server start (the view says "restart required") |
| `description` | no | Text or `{ en, es, gl }` |
| `icon` | no | A PrimeIcons name, e.g. `pi-box` |
| `requires.linea` | no | Semver range of LINEA's own version |
| `requires.hostApi` | no | Semver range of the interface in [§11](#11-versioning) (`ctx` and `ui`). Set it |
| `requires.gitHosts` | no | List of git hosts (`local`, `gitlab`, `github`); the plugin is unavailable while none is on |
| `server` | no | Path to the in-process entry, inside the plugin's folder |
| `client` | no | Path to the web entry. The build uses `client/index.js`: keep that name |
| `settings` | no | The plugin's settings, [§4](#4-settings) |
| `serviceKey` | no | Name of a `secret` setting that is the plugin's key for calling LINEA ([§8](#8-remote-plugins-the-service-contract)) |
| `service` | no | `{ compose, project?, env? }`: the Docker Compose file of the plugin's own service, which LINEA starts and stops ([§8.1](#81-a-service-that-runs-in-docker)) |
| `remote` | no | `{ baseUrl, health, events, web }` for a remote service. Strings may contain `${NAME}` or `${NAME:-default}`, replaced from the server's environment (only an *unset* variable takes the default: an empty one gives an empty text) |

`remote.health` is a path resolved against `remote.baseUrl` (and needs it: a manifest with `health` and no `baseUrl` is an error). `remote.events` is a full URL. `remote.web` is a page of the service that the Plugins view links to ("Open"). If the plugin has a setting called `url`, its value replaces `remote.baseUrl` and the same start of `remote.events` and `remote.web` (only an address that *begins with* the expanded `baseUrl` is swapped, so write them all from the same variable, as `docs/linea/plugin-examples/echo-plugin` does; the address of the `url` setting loses a trailing `/`, one from `${…}` does not, so do not end `baseUrl` with one). That is how an administrator says where the service is. `health` and `web` paths are resolved with `new URL(path, baseUrl)`: a leading `/` drops any path in `baseUrl`.

## 4. Settings

Each entry of `settings` is `{ type, label, description, default, env, required, public, options, min, max, optionsFrom }`. Types: `string`, `url` (http or https only), `number` (`min`, `max`), `boolean`, `enum` (`options`), `list` (a comma-separated text or an array), `secret`.

A setting's value is, from weakest to strongest: **`default` < `env`** (the server's environment variable named by `env`) **< set in the Plugins view < `linea.config.yml`**. A setting that comes from the file is locked in the view. `required` settings with no value stop the plugin being enabled. `public` settings are sent to the browser (`ui.info.settings`, `ui.settings`); a `secret` can never be public. Secrets are never returned: the API shows `{ isSet }`. `optionsFrom` is a path under `/api/plugins/<id>/` that the settings dialog asks for the choices (`[{ value, label }]`).

## 5. Lifecycle

1. **Catalog.** At each request for the list, and at start, the host reads `marketplace.json` and the manifests.
2. **Install.** An administrator installs it (Plugins view, or `POST /api/plugins/:id/install`), or the deployment does: `LINEA_PLUGINS=a-plugin,b-plugin` (once, for a plugin nobody has decided about), or `plugins:` in `linea.config.yml` (on every start; then the Plugins view cannot change it). Installing imports the `server` entry and calls `register(ctx)`; it has 15 seconds to finish. If `register` throws, nothing it registered is kept, the plugin shows a `loadError`, and enabling it tries again.
3. **Enable / disable.** A switch the host reads on every request and every event: no restart. A disabled plugin's routes answer `404 plugin_disabled`, its event listeners are skipped. The web side is loaded at page load, so the page reloads when the set of enabled plugins changes (the server emits the socket event `plugins:changed`).
4. **Uninstall.** Removes its routes, aliases and listeners. Installing it again loads the code on disk then.

An installed plugin whose `requires` no longer fit is not loaded (`loadError` says why).

## 6. The server side: `register(ctx)`

```js
export default {
  async register(ctx) {
    const router = ctx.router();
    router.get('/ping', ctx.services.requireAuth, (req, res) => res.json({ pong: ctx.id }));
  },
};
```

`ctx` is all a plugin gets of the server. **Never import files of the server.**

| | |
|---|---|
| `ctx.id`, `ctx.dir` | The id; the plugin's folder (absolute) |
| `ctx.isEnabled()` | Whether it is enabled now |
| `ctx.settings()` | The resolved settings (re-read it each time: they change at runtime) |
| `ctx.onSettingsChange(fn)` | `fn(fresh, previous)` (both are resolved values, not the patch) after the settings were saved from the view, only while the plugin is enabled. A failure is logged and does not undo the save |
| `ctx.router()` | An Express router mounted at `/api/plugins/<id>`. May be called more than once. `/settings` and `/health` under it belong to the host |
| `ctx.alias(prefix, base)` | Also serve `prefix` (`/api/…`, a path that used to be the base's) with this plugin's routes. Not for a path the server itself serves. `prefix` may be a RegExp, then `base` is a function from the match to the path |
| `ctx.events.on(name, fn)` | Listen to the server's domain events while the plugin is enabled. Names: `product:generated` (payload `{ productId, lineId, userId, conflicts, stage, version }`), `line:model-changed` (`{ lineId }`). `git:pushed` (`{ host, repositoryId, branch?, username }`; the local host also gives `repositoryPath` and no `branch`) is emitted for a push on any host: the local host reports it itself, GitLab and GitHub through `POST /api/webhooks/<host>` (checked with `GIT_WEBHOOK_SECRET`; see `POST /api/repos/:id/push-hook` in the API reference) |
| `ctx.services` | `requireAuth`, `requireAdmin`, `asyncHandler`, `rateLimit`, `handleValidationErrors`, `errors`, `userRepository`. Nothing else |

Anything registered takes effect only when `register` finishes without error. Routes get the user's normal bearer token authentication through `requireAuth`; a remote plugin's service key also passes it (acting as the user in `X-Act-As`). `requireAuth` and `requireAdmin` set **only `req.userId`** (a string; plus `req.serviceId` on a service-key call): to get the account, `await ctx.services.userRepository.findById(req.userId)` (`{ username, admin, … }`).

## 7. The web side: `register(ui)`

```js
export default {
  register(ui) {
    ui.addNav({ id: 'my', icon: 'pi-box', label: { en: 'My', es: 'Mi' }, to: '/my' });
    ui.addRoute({ path: '/my', name: 'my-plugin:home', component: MyPage });
  },
};
```

`register(ui)` runs once per page load, only for enabled plugins, and may be async. An error is logged and does not stop the others. Bare imports (`vue`, `primevue/*`…) resolve to the app's own copy, so a plugin must not bundle them.

| | |
|---|---|
| `ui.plugin`, `ui.info`, `ui.settings` | The id; `{ id, version, client, web, settings }`; the `public` settings. A snapshot taken at page load: a change in the Plugins view shows after a reload |
| `ui.api` | The app's axios (base `/api`, with the session). Plugin routes are `ui.api.get('/plugins/<id>/…')` |
| `ui.router` | The app's router |
| `ui.addNav({ id, icon, label, to \| href, activeFor })` | A menu entry. `label` is text or `{ en, es, gl }`. `href` is a page outside LINEA, opened in a new tab. Same `id` replaces |
| `ui.addRoute({ path, component, name, props })` | A page in the app's layout. `component` is a component object, or a function `() => import('./Page.vue')` (any function is treated as a lazy loader). Route `name`s are global: a name already taken throws. `router.push({ name })` reaches the page |
| `ui.addPages({ path, shell, children })` | Pages with a frame of their own (`shell` renders a `<router-view>`) |
| `ui.addSlot(name, component, { id, when, order })` | A component in a slot of a page. It receives the slot's context as props (the `featureModel.*` slots: `{ lineId, uvl, uvlInvalid, readOnly, isFeatureModel, loading, requestSave }`; a component that declares no props gets them as attributes of its root element, so declare the ones it uses or set `inheritAttrs: false`); `when(context)` can hide it; lower `order` first (default 100) |
| `ui.addI18n(messages, { keepExisting })` | Merges `{ en, es, gl }` messages. Put a plugin's own words under its own key, e.g. `my.title` |

Slots the pages render today: `featureModel.strip`, `featureModel.actions`, `featureModel.panels` (the model editor). `package.tabs` is a tab of the page of a module or metamodel: its `when` sees `{ kind, id, pkg }` and the component gets `kind`, `packageId` and `pkg`. `line.tabs` is a tab of the line's page: `addSlot('line.tabs', Component, { id, label: { en, es, gl }, order, when })`. `label` is the tab's name, `when({ lineId, line, kind })` can limit it (`kind` is `plain`, `project` or `modular`), and the component receives `lineId` and `line` as props; it opens at `/lines/<id>?tab=plugin-<id>` and its tab goes right after the feature model one. `product.tabs`, `line.create.fields` and `dashboard.widgets` are accepted by `addSlot` but no page renders them yet, so a component put there is not shown.

### Trying a line from a plugin

A plugin that edits a line (its code, its models) can try it without making a product, through LINEA's API as the person (a developer of the line). `lineRef` / `ref` is a branch or commit, and `overrides` (`[{ path, action: 'create' | 'update' | 'delete', content }]`) are files changed and not committed:

| | |
|---|---|
| `GET /api/lines/:id/trial-models?ref=` | What a product of the line has to give a model of: `{ kind, metamodels: [{ name, extension, level, description, requires }], models, featureModel, diagnostics, bundle, offered, configuration }`. `models` holds the smallest valid model of each metamodel (`featureselection` included); `bundle`, `offered` and `configuration` are what the app's `BangoWorkbench` (`components/modules/BangoWorkbench.vue`) needs to edit them with bango's views, as a product's models are |
| `POST /api/lines/:id/trial-models/check` | Validates models with bango against the metamodels of the line, as a derivation does. Body `{ models, features, lineRef, overrides }`: `models` (metamodel → text) go over the smallest valid ones, and the feature selection is made from `features` unless a `featureselection` model is given. Answers `{ ok, diagnostics, metamodels, features, spec, modelsByMetamodel }`: a diagnostic of a model has `file: .linea/models/<name>.<extension>` and a message that starts with `line:column`; `spec` is the models merged into one document (what the templates get as `models`), only when they are valid. Nothing is written |
| `POST /api/lines/:id/derive-trial` | Derives. Body `{ features, lineRef, overrides, include, zip, spec, models }`: with `models`, a project derives with them (checked first: models that are not valid answer `{ ok: false, error, diagnostics }`) |

## 8. Remote plugins: the service contract

A remote plugin is an HTTP service that LINEA knows by `remote` in the manifest.

### LINEA → service

- **Health.** `GET <baseUrl><health>`, unauthenticated, 2 seconds. Any 2xx means **up** (redirects are followed); anything else, an error or a timeout means **down**. The body is not read (the SDK's `healthStatus()` is a good answer: `{"status":"ok"}`).
- **Events.** `POST <remote.events>` with `Content-Type: application/json`, body `{ "event": "product:generated", "payload": { …, "actor": { "username": "ada" } | null } }`, 5 seconds, **no retries**, sent only while the plugin is enabled. An address that is in both `remote.events` and `EVENT_WEBHOOK_URLS` gets one POST. The header `X-Linea-Signature: sha256=<hex>` is the HMAC-SHA256 of the **raw body** keyed by `EVENT_WEBHOOK_SECRET`. A receiver must check it against the bytes it received (SDK: `verifyEventSignature`) and answer 2xx fast. The `payload` of `product:generated` is `{ productId, lineId, userId, conflicts, stage, version, actor }`; `userId` is a LINEA id the service cannot resolve, which is why `actor` (`{ username }`, or null) is there. `product:generated` and `git:pushed` are forwarded (`payload` of `git:pushed`: `{ host, repositoryId, branch?, username, actor }`, where `actor` is the pusher as the host named them: a name, not an authenticated identity, so a receiver acts as that person only if LINEA lets it, as `X-Act-As` does). `EVENT_WEBHOOK_SECRET` is one value for the whole server, read at start (changing it needs a restart); events also go to the URLs in `EVENT_WEBHOOK_URLS`. **If `EVENT_WEBHOOK_SECRET` is not set on the server, no event is forwarded to any plugin.**

### Service → LINEA

Send `Authorization: Service <key>` and `X-Act-As: <username>` to LINEA's API (SDK: `serviceClient`). The key is the value of the plugin's `serviceKey` setting (or an entry of the server's `LINEA_SERVICE_KEYS=id[#scope+scope]:secret,…`). The service acts with what that person can do; the person must have logged in to LINEA once. Routes for administrators need a key with the `admin` scope, which a `serviceKey` never has. Keys are compared in constant time and every use is logged (`[service] <id> as <user>`). Keep the key on the server side. The key the administrator types in the Plugins view and the one the service reads (e.g. `ECHO_SERVICE_KEY`) are two places that must hold the same value. Only **enabled** plugins' keys are accepted: a disabled plugin's service gets `401`. Answers: `401` for a wrong key or a missing `X-Act-As`; `403` for a user that never logged in to LINEA or is disabled, or an admin route without the `admin` scope.

### 8.1 A service that runs in Docker

A plugin that needs a container (flamapy for analytics, the agents' application) says which compose file runs it, and LINEA does the rest. LINEA's own repository carries no plugin compose file and no plugin variable: everything is in the plugin's folder.

```json
"service": {
  "compose": "service/deploy/docker-compose.yml",
  "project": "linea-agents",
  "env": { "LINEA_API_URL": "${LINEA_INTERNAL_URL}", "BOT_USER": "${BOT_USER:-}" }
}
```

| Key | |
|---|---|
| `compose` | Required. A compose file **inside the plugin's folder** (no `..`, not absolute). |
| `project` | Compose project name (default `linea-<id>`). It is what keeps the containers apart from LINEA's own and lets LINEA find them again. |
| `env` | Extra variables for the compose process, `NAME: text` where the text may use `${NAME}` / `${NAME:-default}`. |

What LINEA does:

- **Enable** the plugin (or **Start service** in the Plugins view) runs `docker compose -p <project> -f <compose> up -d --build --remove-orphans` (a container the compose file no longer has goes away); **disable** (or **Stop service**) runs `stop`, so containers and data stay for the next start. A start that fails does not undo the enable: the plugin stays on and the card says why.
- The compose process gets only what the plugin declares: what Docker needs to run (`PATH`, `HOME`, `DOCKER_*`), every setting of the plugin under its `env` name (so a `serviceKey` setting with `"env": "AGENTS_SERVICE_KEY"` reaches the compose file), then `service.env`. **The rest of the server's environment (signing key, database...) does not reach a plugin's containers**: `service.env` is where a manifest names a server variable it wants (`"FLAMAPY_PORT": "${FLAMAPY_PORT:-}"`; an empty value leaves the compose file's own default). `LINEA_INTERNAL_URL` is where a container reaches LINEA (`http://host.docker.internal:<port>`; set it to change it).
- Where it runs. In development, on **the server**'s own `docker` (the CLI and a daemon it can reach). In LINEA's Docker deployment the server has neither and holds no Docker socket: it asks the **plugin runner** (`deploy/plugin-runner`, profile `plugins` of `deploy/docker-compose.yml`), the one container with the socket and a read-only copy of the plugins' folder at the same path as the host's. The server sets `LINEA_PLUGIN_RUNNER_URL` and `LINEA_PLUGIN_RUNNER_KEY` (the runner's `PLUGIN_RUNNER_KEY`, a bearer token); the runner is not published and takes a plugin's **id**, never a path or a command (a plugin without a `service`, or an unknown one, is refused, and so is any variable that is the runner's own). Set `COMPOSE_PROFILES=plugins`, `LINEA_PLUGINS_HOST_DIR` (the absolute path of the `linea-plugins` checkout) and `LINEA_PLUGIN_RUNNER_URL=http://plugin-runner:7070`; the production pipeline does it, and makes `PLUGIN_RUNNER_KEY` in `deploy/.env.prod` once. Without the runner the Plugins view says Docker is not available and a service started by hand shows as *External*. For the dev server, a plugin may ship a `dev.env` for `LINEA_DEV_ENV=<file> npm run dev:up`.
- The Plugins view's dialog can **start, stop, restart, rebuild** (`pull` + `up -d --build --force-recreate`) and **remove** (`down`; volumes are kept) the service, or start, stop and restart **one container**, and follows the logs live. One operation at a time per plugin (a second is a 409); a build takes minutes, so these answer at once and `serviceState.operation` (`kind`, `startedAt`, `finishedAt`, `error`) says how it goes.
- Compose files should not pin `container_name` (two checkouts would collide) and should give every service a healthcheck: LINEA reads it to tell *starting* from *running*.

The state LINEA reports (`serviceState` in `GET /api/plugins`): `running` (every container up), `starting` (one is being created or its healthcheck is still `starting`), `degraded` (up, but a container crashed, was killed or is unhealthy), `failed` (nothing up and one crashed), `stopped`, `unavailable` (no Docker CLI or daemon, or a broken file). When it is `unavailable` and the plugin's `remote.health` answers, the Plugins view calls the service **External** (run outside LINEA, as in LINEA's own Docker image) and shows no start/stop/logs buttons; a plugin that is on and whose service does not answer gets a warning with the reason (containers up: check the address or the logs; otherwise: start it, or check the address). A container that exited with code 0 (the one that initiates a replica set) is not a failure, and 137 or 143 is what `docker stop` leaves: a stop, not a crash. `GET /api/plugins/:id/service/logs?tail=200&service=<name>` gives the containers and the last lines of their logs (10 to 2000; `logs=0` is the state alone; the values of the plugin's `secret` settings and terminal colour codes are removed), and `GET /api/plugins/:id/service/logs/stream` follows them as server-sent events. `POST /api/plugins/:id/service/{start,stop,restart,rebuild,down}` and `POST /api/plugins/:id/service/containers/:service/{start,stop,restart}` do the rest. All of this is admin only.

## 9. Connectivity and health

- `GET /api/plugins` (admin) lists every plugin with `health`: `"up"`, `"down"` or `null` (no service to ask), and `healthDetail`: `{ status, latencyMs, httpStatus, error, checkedAt }`.
- `GET /api/plugins/:id/health` (admin) checks one plugin now: `{ id, inProcess, enabled, status: "up" | "down" | "n/a", latencyMs, httpStatus, error, checkedAt }`. `error` is `HTTP 503`, `no answer in 2000 ms`, or the connection error code (`ECONNREFUSED`, `ENOTFOUND`…). `n/a` is a plugin with no `remote.health` to ask: an in-process one (always as healthy as the server), or a remote one that did not give a health path (`inProcess` tells which). An in-process plugin that does declare `remote.health` is probed like a remote one.
- The Plugins view shows the status with the latency or the reason, has a Refresh button and asks again every 30 seconds.
- Health is probed whatever the plugin's state (installed or not, enabled or not), and `GET /api/plugins` probes every plugin with a service each time it is called.
- Health is information. The host does not disable a plugin whose service is down; its requests fail.

## 10. Rules the tests enforce

`server/src/test/boundary.test.js`: the core never names a plugin; a plugin imports no other plugin and nothing of the core; every folder with a manifest is in the catalog; the words a plugin takes from the app's messages are listed; a `serviceKey` names a `secret` setting. These checks run on the plugins folder of the deployment (`PLUGINS_DIR`), not on `examples/`; `server/src/test/pluginExamples.test.js` runs the examples against the host.

## 11. Versioning

`requires.hostApi` is checked against `HOST_API_VERSION` in `server/src/plugins/PluginHost.js` (now `1.0.0`). It covers `ctx`, `ctx.services`, `ui`, the slot names, the manifest, and the remote contract of [§8](#8-remote-plugins-the-service-contract). Adding something is a minor bump; removing or changing something is a major one. A plugin should say `"hostApi": "^1.0.0"`.

## 12. Using plugins from the web UI and from linea-cli

Everything above is reached through the REST API, so any client can use it; the web UI is one. To manage plugins: `GET /api/plugins`, `POST /api/plugins/:id/install|enable|disable`, `DELETE /api/plugins/:id`, `GET|PUT /api/plugins/:id/settings`, `GET /api/plugins/:id/health`, `POST /api/plugins/:id/service/start|stop`, `GET /api/plugins/:id/service/logs`, `GET /api/plugins/config.yml` (admin; see [api-reference](api-reference.md#plugins-apiplugins)). To use what a plugin serves: `/api/plugins/<id>/…` with the same bearer token. linea-cli lives in its own repository; it needs no plugin-specific code, only these calls. Proposed commands: `linea plugins list|status|enable|disable`, `linea plugins call <id> <path>`.
