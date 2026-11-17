# REST API Reference

Base path: `/api`. All routes except `/users/config`, `/users/login/*` and `/users/loginFromGitLabNative` require a valid JWT in `Authorization: Bearer <token>`.

**Acting for a person from another service.** A service that has its own git host login can send that person's host token instead: `Authorization: GitToken <token>`. The host says who the token belongs to; LINEA maps that username to its own user (a host user that never logged in to LINEA gets 403; none is created) and the request is that user's, with the same permissions. The host answer is cached for 5 minutes, and the presented token is never stored: git operations keep using the one saved at login.

---

## Users `/api/users`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/config` | No | Public config: the git hosts that are on (`hosts`: id, provider, OAuth client ID, address, words) and the `primary` one |
| `POST` | `/login/local` | Validated | Sign in to an account of the local git host (`{ username, password }`) |
| `POST` | `/login/:host` | Validated | Exchange the OAuth code of a host for a LINEA JWT (web/SPA flow; redirect_uri is server-side config) |
| `POST` | `/login/:host/native` | Validated | The same for native clients, against a caller-supplied loopback `redirect_uri` |
| `POST` | `/loginFromGitLabNative` | Validated | Native-client (linea-cli) counterpart: exchange GitLab OAuth code for a LINEA JWT against a caller-supplied loopback `redirect_uri` (see below) |
| `POST` | `/loginFromServiceToken` | Yes | Refresh the session from the stored GitLab refresh token |
| `POST` | `/logout` | Yes | Invalidate the current session |
| `GET` | `/me/sessions` | Yes | The person's sign-ins (one per browser or device; no tokens), `current` marks the asking one |
| `DELETE` | `/me/sessions/:id` | Yes | End one sign-in |
| `DELETE` | `/me/sessions` | Yes | End every sign-in (`?others=true`: all but this one) |
| `DELETE` | `/:id/sessions` | Admin | Sign a person out everywhere |

**`POST /loginFromGitLabNative`** exists for `linea-cli`'s cloud mode, which
(per RFC 8252 §7.3) authorizes against GitLab through a loopback HTTP listener
on an ephemeral port instead of the SPA's fixed route — so the `redirect_uri`
used for the token exchange must be supplied by the caller and must be
identical to the one used at the authorization step.

Body: `{ code: string, redirect_uri: string }`.

`redirect_uri` is not used to build a URL the server fetches — it only rides
inside the JSON body of the `POST /oauth/token` request the server makes to
GitLab's own, fixed host (`gitlab-commando`'s `RequestAccessTokenCommand`), so
accepting an arbitrary value here is **not an SSRF vector**. The whitelist is
still enforced as defense in depth, before ever calling GitLab
(`isAllowedNativeRedirectUri` in `src/rest/validators/userValidators.js`,
wired in via `body('redirect_uri')` so only the JSON body counts — not the
query string, params, headers, or cookies `check()` would also read):
without it, this endpoint could be used as a relay to complete an
authorization-code exchange minted for a *different* registered
`redirect_uri` (e.g. the web SPA's own), if such a code ever leaked through
another channel (referrer header, browser history, logs). The server rejects
with `400` — no GitLab call attempted — unless **all** of the following hold,
checked via `new URL()` on a value required to already be in canonical form
(`new URL(value).href === value`) — never via string/regex matching on the
raw URI:
- scheme is exactly `http`;
- host is the literal `127.0.0.1` or `[::1]` — **not** `localhost` (DNS-resolved,
  can be hijacked);
- path is exactly `/callback`;
- no userinfo, query string, or fragment;
- port is unconstrained (RFC 8252 §7.3 explicitly forbids requiring a fixed
  port for loopback redirects, since native apps bind an ephemeral one).

Everything else about the flow (transaction, `gitlabSession.rollback()` on
failure, user upsert, avatar) is shared with `/login/:host` via
`UserService#exchangeCodeAndUpsertUser`; only the `redirect_uri` source
differs.

**Authorization model.** Logging in only establishes the GitLab identity — it does
not require membership of any particular group or project. Every subsequent
operation is authorized against the specific GitLab project it touches, using the
user's own OAuth token (`PermissionChecker.checkUserExistsAndHasPrivileges`), and
`GET /lines/enrolled` returns exactly the `spl`-topic projects that token can
reach. A token that GitLab rejects surfaces as `401` with `code: "GIT_HOST_AUTH"`,
which callers may resolve with a refresh-and-retry; a `403` means the identity is
fine but lacks the required access level on that project.

---

## Lines `/api/lines`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/` | Create a new line. Optional `parentNamespaceId` picks the GitLab group its group is created under; omitted → a top-level group |
| `GET` | `/enrolled` | All lines the user is a member of |
| `GET` | `/namespaces` | GitLab groups the user may create a line under (`[{ id, fullPath, name }]`), for the creation form's picker |
| `GET` | `/:id` | Get a line by ID (includes members). `?brief=1`: the line alone |
| `GET` | `/:id/products` | The line's products as stored; `?spec=1` also reads each spec from the git host, and `cut=1` fails with 503 instead of serving a stored spec when the host cannot be read |
| `DELETE` | `/:id` | Delete a line and all its products |
| `GET` | `/:id/model` | Get the feature model file content (UVL or XML). `409 line_kind_unavailable` when the line's kind belongs to a plugin that is not enabled |
| `PUT` | `/:id/model` | Save/update the feature model |
| `POST` | `/:id/model/convert` | Convert between UVL and XML |
| `POST` | `/:id/derive-trial` | Try a derivation of the line's platform for a configuration, making no product and no repository: `{ features: [names], lineRef?, overrides?: [{ path, action: create\|update\|delete, content? }] }` (`lineRef`: a branch or commit; `overrides`: files changed and not committed; `spec`: a sample of the product's spec for the templates' `data`; `include`: paths whose text comes back in `contents`; `zip: true`: the whole derived product comes back too, as base64) → `{ ok: true, files, size, contents?, zip? }`, or `{ ok: false, error, diagnostics }` when it does not derive. Needs developer access to the line |
| `POST` | `/:id/plan-branch` | Commit a feature model (`content`) to a plan branch (made from main when `branch` is omitted) → `{ branch }` |
| `POST` | `/:id/plan-branch/commits` | Commit file changes to a plan branch: `{ branch?, slug?, message?, actions: [{ action: create\|update\|delete, file_path, content }] }` → `{ branch }`. `branch` must be `plan/…` |
| `POST` | `/:id/plan-branch/merge` | Merge a `plan/…` branch into main through a merge request: `{ branch, title? }` → `{ merged, conflicts, mrIid }` |

---

## Plugins `/api/plugins`

The base's own API for plugins. What a plugin serves is under `/api/plugins/<id>/…` while it is enabled (`404 plugin_disabled` otherwise).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | Admin | The catalog with each plugin's state: `installed`, `enabled`, `compatible` (its `requires.linea` fits), `health` (`up`/`down`, `null` for a plugin with no service), `healthDetail` (`{ status, latencyMs, httpStatus, error, checkedAt }`), `loadError` |
| `GET` | `/enabled` | No | What the web client loads: `[{ id, version, client, web, settings }]` for the enabled plugins (`settings`: only the `public` ones) |
| `POST` | `/:id/install` | Admin | Installs (loads its server side); it starts off. Installing what is installed changes nothing |
| `POST` | `/:id/enable` | Admin | Switches it on, without a restart |
| `POST` | `/:id/disable` | Admin | Switches it off |
| `DELETE` | `/:id` | Admin | Uninstalls (and disables) |
| `GET` | `/:id/health` | Admin | Checks the plugin's service now: `{ id, inProcess, enabled, status: up\|down\|n/a, latencyMs, httpStatus, error, checkedAt }` |
| `GET` `PUT` | `/:id/settings` | Admin | The settings schema, values (secrets masked) and where each comes from; `PUT` saves a patch |
| `GET` | `/config.yml` | Admin | The installed plugins and their settings as a `linea.config.yml` |

How to write a plugin: [plugins.md](plugins.md).

An administrator is a user named in `ADMIN_USERS`. Plugins named in `LINEA_PLUGINS` are installed and enabled at the first start.

### analytics-plugin

`POST /api/plugins/analytics-plugin/analyze` (feature count, constraints, satisfiability...), `/analyze/bdd`, `/analyze/metric`: `{ uvl, mode }`. Also served at their old paths (`/api/lines/analyze*`).

---

## Modules and metamodels

`/api/registry` (`/status`, `/suggestions`, `POST`, `DELETE`) lists what this LINEA offers; `/api/packages/:kind[/:id[/file|files|studio|check|publish]]` are the modules and metamodels themselves; for lines, `GET|PUT /api/lines/:id/modules`, `POST /api/lines/:id/modules/check`, `POST /api/lines/modules/preview`, `POST /api/lines/metamodels/preview`. A line's feature model from a UVL text: `POST /api/lines/:id/model/from-uvl`.

## Settings and users (administrators)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings/git-hosts` | The git hosts: on or off, their settings (secrets masked), where each value comes from |
| `PUT` | `/api/settings/git-hosts/:host` | `{ enabled?, settings? }`; what `linea.config.yml` declares answers `409` |
| `GET` | `/api/users` | The people who can sign in |
| `POST` | `/api/users` | `{ username, password, admin? }`: an account on the local host |
| `PUT` | `/api/users/:id/password` | `{ password }` (also makes a new git token) |
| `POST` | `/api/users/login/local` | `{ username, password }`: sign in with an account of the local host |

Git over HTTP of the local host: `/git/<group>/<name>.git`, with the account's username and its password or git token (`GET /api/users/git-credentials`).

---

## Products `/api/products`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/` | Create a product (validates feature selection, creates GitLab repo) |
| `GET` | `/enrolled` | All products the user is a member of |
| `GET` | `/by-git-project/:projectId` | The product made in a git project (404 if none, 403 if the caller cannot read it). `?spec=1` serves its spec as the git host has it, with `specSource` (`repo` or `mongo`) and `specReason` (`infra`, `absent`, … when the stored one had to be used) |
| `GET` | `/:id` | Get a product. `?brief=1`: the stored product alone (no members, spec or deployment) |
| `PUT` | `/:id/selection` | Save the feature selection from `{ features: [names] }`; the model text is made on the server and the spec's `features` follow |
| `GET` | `/:id/activity` | GitLab activity: commits, MRs, pipelines |
| `GET` | `/:id/health` | Feature model validity check for this product |
| `GET` | `/:id/conflicts` | Current merge conflicts (from open MRs) |
| `DELETE` | `/:id` | Delete a product and its GitLab repo |
| `PATCH` | `/:id` | Update product spec (feature selection, data model, …) |
| `POST` | `/:id/rename` | Rename a product |
| `POST` | `/:id/generate` | Trigger generation (bigbang commit + MR); auto-enqueues Sync on conflict |
| `POST` | `/:id/zip` | Generate and download a ZIP of the product code (base64). Body: `spec?`; `lineRef?` (a branch or commit of the line to derive from) and `overrides?` (`[{ path, action: create\|update\|delete, content? }]`, files changed in the platform first; nothing is written). `lineRef` and `overrides` need developer access to the line |

---

## Repositories `/api/repos/:id`, `/api/lines/:id/repo`, `/api/products/:id/repo`

The code of the repository of a line or a product, on whatever git host it is, as the person asking (their access on the host is the limit: reads need reporter, writes developer, the hook maintainer). `/api/repos/:id` names the repository by its own id on the host (`?host=` when it is not the primary one); the others by the id of the line or product. `/api/repos/:id/mrs` has the merge-request routes of the line and product ones.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | `{ id, path, webUrl, defaultBranch, baseBranch }` |
| `GET` / `POST` | `/branches` | The branch names / make one (`{ branch, ref }`; a branch that exists is `400` with the host's words in `detail`) |
| `GET` | `/branch?name=` | A branch and its last commit |
| `GET` | `/files?ref=` | Every file path at a ref |
| `GET` | `/file?path=&ref=` | A file (`content` in base64, `revision`); `404` when there is none |
| `GET` | `/commits?ref=&perPage=` | The latest commits of a ref |
| `POST` | `/commits` | One commit on `branch`: `{ branch, message, actions: [{ action, path, content?, encoding? }] }` |
| `GET` | `/compare?from=&to=` | What `to` has that `from` has not: `{ commits, files }` |
| `GET` | `/archive?ref=` | A zip of the repository at a ref |
| `POST` | `/push-hook` | Asks the host to report pushes to `POST /api/webhooks/<host>` (needs `PUBLIC_URL` and `GIT_WEBHOOK_SECRET`; `{ status: 'created' \| 'already_exists' \| 'unavailable' }`) |

A ref or branch name that starts with `-`, or a path with `..`, is `400`.

`POST /api/webhooks/:host` is where GitLab and GitHub tell LINEA about a push (not for people: signed with `GIT_WEBHOOK_SECRET`, checked by the host's provider). It becomes the `git:pushed` event.

## Health `/api/health`
`GET /api/health` (liveness, no auth, no DB → `{status:'ok'}`), `GET /api/health/ready` (readiness, no auth, cached ~5 s: Mongo ping, every enabled git host (remote reachable; local folder writable), scheduler freshness; 503 if any fails; returns only `ok` booleans per check), `GET /api/health/details` (admin only: LINEA, linea-core and linea-git versions, enabled plugins, uptime, full readiness detail incl. errors and job state).

## Logs `/api/logs`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/:id/versions` | Available log versions for a product |
| `GET` | `/:id/:version` | Logs for a specific product version |

---

## Migration `/api/migration`

What a feature model means for the products of a line, from the validator alone (no agent involved).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/lines/:lineId/status` | Every product of the line checked against its current feature model, with the reason each one fails |
| `POST` | `/lines/:lineId/impact` | Every product checked against the current model and a proposed one (`content`): breaking, fixing, unaffected |

---

## WebSocket Events

The server emits to the **per-user Socket.IO room** (room name = userId). The client joins after authenticating:

```js
socket.emit('auth', jwtToken)
```

### Inbound (client → server)
| Event | Payload | Description |
|-------|---------|-------------|
| `auth` | `token: string` | Authenticate and join user room |

### Outbound (server → client)
| Event | Payload | Description |
|-------|---------|-------------|
| `generation` | *(generation-specific)* | Product generation progress |
| `ai-impact` | *(legacy)* | Impact analysis streaming |
| `ai-migration` | *(legacy)* | Migration status streaming |


## Settings `/api/settings` (administrators)

| Method | Path | Description |
|--------|------|-------------|
| `GET`/`PUT` | `/git-hosts`, `/git-hosts/:host`, `/git-hosts/primary` | Which git hosts are on and how each is set |
| `GET`/`PUT` | `/instance` | How this LINEA behaves (`sessionHours`, `maxFailedSignIns`, `lockMinutes`, `minPasswordLength`, `modulesPublish`, `modulesRegister`, `auditRetentionDays`): `{ schema, values, meta }`; `null` takes a setting back to its default; what `instance:` of linea.config.yml sets is locked |
| `GET` | `/audit` | Who changed what, newest first (`limit`, `before`, `action` prefix, `actor`) |
| `POST` | `/import` | `{ text, apply }`: a linea.config.yml. Without `apply` it answers what would change (`changes`, `notes`, `warnings`); with it, each change is made and `applied` says which worked. It never removes anything, and secrets written as `${VAR}` are not copied |
