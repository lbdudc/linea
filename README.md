# LINEA

[![CI](https://github.com/lbdudc/linea/actions/workflows/ci.yml/badge.svg)](https://github.com/lbdudc/linea/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@lbdudc/linea-cli?label=%40lbdudc%2Flinea-cli)](https://www.npmjs.com/package/@lbdudc/linea-cli)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

Lifecycle management for **software product lines** (SPLs): model a line (features, metamodels, modules), derive a product for each customer,
and keep both alive in git (branches, merge requests, CI, deployments). Works with its own built-in git host, GitLab or GitHub.

Documentation: **https://lbdudc.github.io/linea-web/** · Plugins: [`lbdudc/linea-plugins`](https://github.com/lbdudc/linea-plugins) · Metamodels: [`lbdudc/linea-metamodels`](https://github.com/lbdudc/linea-metamodels)

## Run it with Docker

LINEA keeps its repositories itself (the `local` git host), so a first try needs neither GitLab nor GitHub.

```bash
git clone https://github.com/lbdudc/linea
cd linea/deploy
cp .env.example .env     # set JWT_SIGN_KEY and LINEA_ADMIN_PASSWORD (both are placeholders)
docker compose up -d
```

Open http://localhost:9000 and sign in as `admin` with the `LINEA_ADMIN_PASSWORD` you set. `docker compose up` pulls MongoDB, a proxy and
two public images, for amd64 and arm64:

| Image | What |
|---|---|
| `ghcr.io/lbdudc/linea-server` | API, git host, generation; carries the official plugins and the metamodels |
| `ghcr.io/lbdudc/linea-client` | the web interface (built with the plugins' client code) |

Tags are the release versions (`0.2.0`, `0.2`, `latest`); pin one with `LINEA_VERSION=0.2.0` in `deploy/.env`.

| Setting (`deploy/.env`) | Default | What |
|---|---|---|
| `JWT_SIGN_KEY` | *(required)* | signs the sessions: a long random string (`openssl rand -hex 32`) |
| `ADMIN_USERS`, `LINEA_ADMIN_PASSWORD` | `admin` / placeholder | the first administrator of the `local` host |
| `PROXY_PORT`, `REDIRECT_URI` | `9000`, `http://localhost:9000` | where LINEA is served; set both for another port or a public address |
| `LINEA_VERSION` | `latest` | tag of the images |
| `LINEA_CONFIG_DIR` | `./config` | folder with a `linea.config.yml` (git hosts, plugins): see `linea.config.example.yml` |
| `LINEA_REGISTRY` | `local:registry/index` | where the metamodels are published at start |

GitLab or GitHub instead of the built-in host: `deploy/config-gitlab/` and the guides in the documentation. The analysis service of the
analytics plugin runs with `docker compose -f docker-compose.yml -f docker-compose.plugins.yml up -d`. To run a change you made: `docker compose up -d --build`
(the build expects `linea-plugins` and `linea-metamodels` checked out next to this repository).

## Use the pieces from npm

| Package | What | Use it |
|---|---|---|
| [`@lbdudc/linea-cli`](packages/cli) | LINEA from the terminal (needs [Bun](https://bun.sh)) | `bunx @lbdudc/linea-cli` or `bun add -g @lbdudc/linea-cli` |
| [`@lbdudc/linea-core`](packages/core) | The engine: feature models, validation, derivation. Works offline. | `npm i @lbdudc/linea-core` |
| [`@lbdudc/linea-git`](packages/git) | One interface over the git hosts (local, GitLab, GitHub) | `npm i @lbdudc/linea-git` |
| [`@lbdudc/linea-ci`](packages/ci) | CI steps for lines and their products | `npx @lbdudc/linea-ci` |
| [`@lbdudc/linea-plugin-sdk`](packages/sdk) | Helpers for writing plugins | `npm i @lbdudc/linea-plugin-sdk` |

All five share one version (the release tag) and are published with provenance.

## Layout

```
packages/   core, git, cli, ci, sdk      published to npm
apps/       server, client               the web app (published as Docker images)
deploy/     Compose files and example configuration
docs/       architecture, plugin contract, API reference
e2e/        end-to-end suite (Chrome)
scripts/    release helpers
```

The line between the core and the plugins is enforced by `apps/server/src/test/boundary.test.js` ([architecture](docs/linea/architecture.md)).

## Develop

Node 22 (see `.nvmrc`) and MongoDB as a replica set (`docker compose -f deploy/docker-compose.yml up -d mongo mongo-init-replica`).

```bash
npm install
npm run build        # core and git, which the apps use
npm test             # core, git, ci, cli (needs Bun), server and client
npm run dev          # server + client
```

The plugins and the metamodels are other repositories. Check them out next to this one (`../linea-plugins`, `../linea-metamodels`), or point
`PLUGINS_DIR` and `LINEA_METAMODELS_DIR` at them: the tests that need the metamodels use them, and the plugins' own tests run in
their repository.

## Release

Create a **GitHub Release** with a tag `vX.Y.Z`: that tag is the version of every package. The *Release* workflow publishes the five npm packages (npm
trusted publishing, no token) and adds every commit since the previous tag to the release notes; the *Docker* workflow publishes the two images. A tag like
`v1.2.3-rc.1` is a prerelease and goes to the `next` dist-tag. Details in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE). © Laboratorio de Bases de Datos (LBD), Universidade da Coruña.
