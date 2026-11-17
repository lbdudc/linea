# Architecture

## Core, configuration and plugins

LINEA is a **core**, **configuration** and **plugins**, and each thing belongs to exactly one of them:

| | What it is | The test |
|---|---|---|
| **Core** | What every line or product goes through: the SPL engine (`spl.json`, lockfile, metamodels, modules and their registry, derivation), storage on git hosts, accounts and login, products, generation and deployments, the model editor, domain events and webhooks, service-key authentication | LINEA does not work without it |
| **Configuration** | Choosing or tuning one of several ways to do a job the core needs: **which git hosts** (local, GitLab, GitHub) and their credentials, the primary host, where the repositories are, the registry, administrators, webhooks | Read at start from `linea.config.yml` or the environment; an administrator can change what the file does not lock (Settings → Git hosts) |
| **Plugin** | An optional capability that adds surface (routes, pages, slots, nav) and often a service of its own | LINEA is complete without it, and it can be switched on and off while running |

Rules that tests enforce (`server/src/test/boundary.test.js`): the core never names a plugin; a plugin imports only what the host gives it (`ctx`, `ctx.services`, `ui`, the shared packages) and never another plugin; an extension point exists only while some plugin uses it.

```
LINEA/
├── linea/                         the core
│   ├── server/
│   │   ├── index.js               entry point: mounts routers (and /git), connects the DB, migrates it, loads the git hosts and the plugins
│   │   └── src/
│   │       ├── config/            linea.config.yml, the settings resolver, the schemas of the git hosts
│   │       ├── model/             entities, repositories, services (the engine, the registry of packages), git hosts, migrations
│   │       ├── plugins/           PluginHost (catalog, install/enable at runtime), what plugins may use (`services`)
│   │       └── rest/              routers, controllers, validators, common (auth...)
│   └── client/
│       └── src/                   pages (lines, products, modules, git hosts, users, plugins), plugins/ (what plugins add: nav, routes, slots)
├── plugins/
│   ├── marketplace.json           the catalog
│   ├── analytics-plugin/          flamapy analysis: server routes, UI panels, and service/ (the Python service)
│   ├── agents-plugin/             the AI agents (service/ is the linea-agents repo, deployed apart; ../linea-agents links to it)
│   ├── module-code-editor/        the Code tab of a module: file editor, models of its metamodels, derivation compared run by run, code insertion points
│   └── spl-code-editor/           the Code tab of simple SPLs: file editor, feature<->code annotations, trial derivation (its own repo, linea/plugins/spl-code-editor)
├── linea-core/  linea-git/        libraries (offline engine; the git hosts: local, GitLab, GitHub)
└── linea-agents -> plugins/agents-plugin/service
```

The contract between LINEA and a plugin (manifest, `ctx`, `ui`, the service protocol, health) is in [plugins.md](plugins.md).

What a plugin switches on and off is checked on every request, so installing, enabling and disabling take effect without a restart.

### Git hosts

Lines and products live in git repositories, so a LINEA has at least one **git host**, and any number of them can be on together (a line is made on one of them and stays there):

- **`local`**: the repositories are on the server itself (bare repositories in `LINEA_REPOS_DIR`, served to `git clone` / `git push` at `/git`). It is on when nothing else is configured, and then people sign in with **accounts made here** (a username and password; `ADMIN_USERS` plus `LINEA_ADMIN_PASSWORD` make the first administrator, who makes the rest in **Users**). It runs no pipelines.
- **`gitlab`** and **`github`**: people sign in with the host (OAuth) and lines live in its groups or accounts.

Each is set under `gitHosts:` of `linea.config.yml`, by the environment (`GITLAB_HOSTNAME`..., `GITHUB_CLIENT_ID`..., `LINEA_REPOS_DIR`; `GIT_PROVIDER` names the primary one) or, for what the file does not lock, in **Settings → Git hosts** (kept in MongoDB). What the interface calls things (merge request, pull request, change request) comes from the host in use.

A line whose host is off stays listed; what needs its host answers `503 GIT_HOST_UNAVAILABLE`.

**What does not move by itself.** Every user, line and product names its host (`gitHost`); the **primary host** (the one of whatever predates hosts) is kept the first time an administrator changes the hosts (`PUT /api/settings/git-hosts/primary` changes it on purpose; `gitHosts.primary` of the file locks it). Switching GitLab or GitHub on keeps `local` on when it holds accounts, lines or products. Switching a host off that people or lines are on answers `409` with how many (`preview`) and needs `force`; the host of the registry (`LINEA_REGISTRY`) and the primary host of the file cannot be switched off; at least one usable host stays on. What a person can do with a host that is off is sign in through another host of theirs; with none on, the interface says so.

**Order of precedence** for a host's settings: `linea.config.yml` (locks) > Settings (MongoDB) > environment > default. The Settings form sends only what the person changed, so values that come from the environment or the defaults are not frozen into the database; a stored value or secret can be forgotten (back to the environment's). A bad file is not guessed at: `"false"` is false, a typo in `enabled` switches the host off, a non-mapping `gitHosts:` stops the start, and what is wrong is warned at start.

**The local host in production.**
- *One process per data folder* (`LINEA_REPOS_DIR`: bare repositories and `state.json`). A lock file guards against a second process (the CLI) writing at the same time; two servers on one folder are not supported. The state is written to disk before it replaces the old file, and the last good copy (`state.json.bak`) is used if it is damaged.
- *Back up Mongo and the repositories volume together* (accounts and lines are in Mongo, repositories and their members and change requests in the folder).
- *Permissions are the host's levels* (guest 10 … owner 50), the same through the API and through `git` over HTTP: reading needs a reporter, pushing a developer, pushing to the default branch a maintainer; the default branch can never be deleted or force-pushed; the registry's group is read-only for everybody but its owner and the administrators (so only an administrator registers or unregisters a package). By default everybody who has an account works in every repository (maintainer) unless a member record says less (the owner of a line manages them from the line page).
- *Git needs 2.38+* (checked at start). Deleted lines and products wait a week in `trash/` of the folder (and come back if the work that deleted them fails).
- *Accounts*: names are letters, digits, `.`, `-`, `_` (not `registry`); passwords 8–72 bytes; wrong passwords are counted per person and address (`/api/users/login/local` and `git` share the count; `429` for a while); a person changes their own password and renews their git token under **Local account**; administrators can disable or delete an account (its repositories go to another person, or to a name nobody can sign in with). The git token is not kept: it is made from the account, a version number and the server's secret (`JWT_SIGN_KEY`), so a copy of the database opens no repository; renewing it raises the version, and changing the secret renews every token (people sign in again). `LINEA_MAX_PUSH_MB` limits one push; `LINEA_MAX_SPEC_MB` (16 by default) limits the body of saving a product's spec, of trying a line with models, of a commit made through `…/repo/commits` and of what is sent to a plugin (`/api/plugins/…`) (the rest take up to 512 KB); `TRUST_PROXY` is the `trust proxy` of Express (1 by default) so the count sees real addresses.

### Administrators and profiles

**Configuration is for administrators** (like an n8n owner/admin: they set up the instance, everyone else uses it). The git hosts (Settings), the plugins (install, switch on and off, their settings, the config download) and the people (**Users**: make accounts, set passwords, make or remove administrators; the last administrator cannot be removed) answer `403` to anyone else, and the interface hides them: no entry in the navigation, and the address of the page sends a person home. What the page needs before anyone signs in (`GET /api/plugins/enabled`, `GET /api/users/config`) stays public and carries no settings. `ADMIN_USERS` names the first administrators.

**Profiles**: a person can be signed in to several hosts (their own, plus others added from the user menu), but LINEA shows **one remote at a time**: the `activeHost` of their account, their *profile*. The lines, products, dashboard and the form that makes a line are those of that host; the words of the interface (pull request, change request) follow it. With two or more remotes the header has a switch (`PUT /api/users/profile {host}`); the choice is kept on the account. A host that is switched off, or an account that is removed, sends the profile back to the person's own host. The modules registry is a different matter: it lives on the primary host and is read with the person's account there.


---

## Feature Model Analysis Service (analytics-plugin)

Feature model analysis runs in a dedicated Python service rather than in-process: `plugins/analytics-plugin/service/` (FastAPI +
flamapy). The plugin's server routes (`/api/plugins/analytics-plugin/analyze*`, also answering at the old `/api/lines/analyze*`) are a thin
HTTP client to it (`FLAMAPY_API_URL`), and its client code fills the `featureModel.strip` and `featureModel.panels` slots of the model editor.

### Why a separate service

The previous approach embedded flamapy inside Node.js via Pyodide (Python-in-WebAssembly). On large models (200+ features) the WASM heap would exhaust memory and crash the container. Native CPython is ~16× faster on the same model and has no WASM memory ceiling.

### Two-phase analysis

Analysis is split across two endpoints so the UI never blocks:

| Endpoint | Operations | Speed | Response |
|---|---|---|---|
| `POST /analyze` | Structural (7 ops) + PySAT (satisfiable, deadFeatures, falseOptional) | Always fast (< 500 ms) | Immediate — populates the main panel |
| `POST /analyze/bdd` | BDD group (7 ops) + enumeration (≤ 30 features only) | Size-dependent, seconds on large models | Background — UI shows spinners until it resolves |

The client fires `/analyze` first, renders results, then fires `/analyze/bdd` in the background without a blocking overlay. If `_skipped` in the BDD response is non-empty (enumeration was skipped), a "partial analysis" notice is shown.

`safe()` on the Python side catches solver exceptions and returns `null` for individual fields so a single failing operation never aborts the whole response.

### Key Boundary Rule

LINEA knows nothing about the AI agents subsystem (`linea-agents`, a separate deploy). It reaches LINEA only through the REST API, and `ProductService.generateProduct` emits `DOMAIN_EVENTS.PRODUCT_GENERATED` on `domainEvents`; `domainEventBridge.js` forwards it (and `git:pushed`, a push to a repository on any host), signed, to the URLs in `EVENT_WEBHOOK_URLS` and to the `remote.events` of the enabled plugins that have one.

---

## Deploying with a config file (plugins and their settings)

What a deployment runs is described in `linea.config.yml` (`LINEA_CONFIG`; in Docker `deploy/config/linea.config.yml` is mounted at
`/config`; example: `deploy/linea.config.example.yml`):

```yaml
gitHosts:
  primary: local
  local:  { dataDir: /data/repos }
  gitlab: { url: "https://gitlab.example.com", clientId: "${GITLAB_CLIENT_ID}", clientSecret: "${GITLAB_SECRET_ID}" }
plugins:
  analytics-plugin: { enabled: true, settings: { url: "${FLAMAPY_API_URL:-http://flamapy-server:8000}" } }
  agents-plugin:    { enabled: false }
```

- A git host or plugin **listed** in the file is put in that state on every start (so it survives a wiped MongoDB) and is *locked*: the Plugins view
  shows it as `linea.config.yml` and the server refuses to install, enable, disable or uninstall it. Its settings in the file cannot be edited
  in the view either; the other settings of that plugin can.
- A plugin **not listed** is whatever people chose in the Plugins view, kept in MongoDB (as before); `LINEA_PLUGINS` still provisions
  plugins that have no record yet.
- A setting resolves as `default` < environment variable < saved in the view < file. Secrets are written as `${VAR}` and read from the
  environment, so the file can be kept in git.
- A declared plugin that is missing a required setting is left disabled, with a warning in the log.
- **Plugins view -> Download config** (`GET /api/plugins/config.yml`, admin) writes the current choices as such a file; secrets become
  `${PLUGIN_KEY}` placeholders.
- The file is read at start: change it and restart the server. A missing `LINEA_CONFIG` path, or invalid YAML, stops the server.

## Data Model

### Line

| Field | Type | Notes |
|-------|------|-------|
| `name` | String (unique) | SPL identifier |
| `version` | String | Semantic version |
| `description` | String | Optional |
| `featureModelType` | `'UVL'` \| `'XML'` | Format of the feature model file |
| `gitHost` | String | The git host it lives on (`local`, `gitlab`, `github`) |
| `repoId` | Number | ID of the line repository on its host |
| `namespaceId` | Number | ID of the group that is the line |
| `webUrl` | String | Browser URL to the repo |
| `webIdeUrl` | String | Web IDE URL |
| `ownerId` | ObjectId → User | Fallback attribution for scheduled/webhook runs when the triggering git user has no LINEA account |

### Product

| Field | Type | Notes |
|-------|------|-------|
| `spec.basicData.name` | String | Product name |
| `spec.basicData.version` | String | Semantic version |
| `spec.features` | String[] | Selected feature identifiers |
| `spec.dataModel.cells` | Array | Data model entries |
| `spec.statics` | Array | Static assets |
| `lineId` | ObjectId → Line | Parent line |
| `repo.id` | Number | ID of the product repository on its host |
| `repo.webUrl` | String | Browser URL |
| `repo.webIdeUrl` | String | Web IDE URL |
| `lastSyncAt` | Date | Last successful generation timestamp |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GIT_PROVIDER` | No | The primary git host (`local`, `gitlab`, `github`); it is also switched on. Default: the first one configured, else `local` |
| `LINEA_REPOS_DIR` | No | Where the `local` git host keeps its repositories (default `./.data/repos`; a volume in Docker) |
| `LINEA_GIT_URL` | No | The address the repositories of the `local` host are served at (default `<REDIRECT_URI>/git`) |
| `LINEA_ADMIN_PASSWORD` | No | The password of the administrators of `ADMIN_USERS` that have no account yet on the `local` host (made at start) |
| `GITLAB_HOSTNAME`, `GITLAB_CLIENT_ID`, `GITLAB_SECRET_ID` | No | A GitLab to sign in with and keep lines on (its address switches it on). Same as `gitHosts.gitlab` |
| `GITHUB_URL`, `GITHUB_API_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | No | A GitHub (or GitHub Enterprise Server), the same as `gitHosts.github` |
| `REGISTRY_DIR` | No | A folder with `metamodels/` and `modules/`: with `LINEA_REGISTRY=local:<group>/index` they are published into the `local` host at start (the Docker image has them in `/srv/registry`) |
| `JWT_SIGN_KEY` | Yes | Secret used to sign LINEA JWTs |
| `FLAMAPY_API_URL` | No | URL of the flamapy analysis service of the analytics plugin (default `http://flamapy-server:8000`; use `http://127.0.0.1:8000` for local dev outside Docker) |
| `ADMIN_USERS` | No | Comma-separated usernames that are administrators: they can change git hosts, users and plugins |
| `LINEA_PLUGINS` | No | Comma-separated plugin ids installed and enabled at start when nobody has decided about them yet |
| `PLUGINS_DIR` | No | The folder of plugins (default: `plugins/` next to `linea/`) |
| `AGENTS_URL`, `AGENTS_WEB_URL` | No | Where the agents plugin's service is, for LINEA (health, events) and for the browser |
| `mongoUrl` | No | Full MongoDB URL (overrides constructed URL) |
| `port` | No | HTTP server port (default 3000) |
| `EVENT_WEBHOOK_URLS` | No | Comma-separated URLs that get a signed POST for each generated product (the enabled plugins' receivers get it too); with neither, nothing is sent |
| `EVENT_WEBHOOK_SECRET` | No | Key for the HMAC-SHA256 in the `X-Linea-Signature` header. Without it no event is sent to any receiver, `git:pushed` included |
| `GIT_WEBHOOK_SECRET` | No | The secret GitLab and GitHub sign their push webhooks with (`POST /api/webhooks/<host>`). Without it those pushes are refused; the local host needs none |
| `PUBLIC_URL` | No | The address the git hosts reach LINEA at: the webhook LINEA asks a host to register (`POST /api/repos/:id/push-hook`) points at `PUBLIC_URL/api/webhooks/<host>` |

> **Docker note:** env vars are read at container creation from the `env_file`. If you add/change a key in `.env` after the container was created, run `docker compose up -d --force-recreate server` to pick it up.
>
> The `FLAMAPY_API_URL` in `docker-compose.yml` is set directly in the `environment:` block (`http://flamapy-server:8000`), which overrides the `env_file` value. You only need to change it in `.env` when running outside Docker.
