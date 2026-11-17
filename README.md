# LINEA

Application lifecycle management for **software product lines** (SPLs): model a line (features, metamodels, modules), derive products from it,
and keep both alive in git (branches, merge requests, CI, deployments).

- Run it with Docker in a minute (below), or install the CLI with npm.
- Docs and site: **https://github.com/lbdudc/linea-web** (the landing and the documentation).
- Plugins: [`lbdudc/linea-plugins`](https://github.com/lbdudc/linea-plugins). Metamodels: [`lbdudc/linea-metamodels`](https://github.com/lbdudc/linea-metamodels).

## Quickstart (Docker)

LINEA keeps its repositories itself (the `local` git host), so you need neither GitLab nor GitHub to try it.

```bash
git clone https://github.com/lbdudc/linea && cd linea/deploy
cp .env.example .env          # change JWT_SIGN_KEY and LINEA_ADMIN_PASSWORD before exposing it anywhere
docker compose up -d          # pulls ghcr.io/lbdudc/linea-server and linea-client, with MongoDB and a proxy
```

Open http://localhost:9000 and sign in as `admin` (the password is `LINEA_ADMIN_PASSWORD`). The images carry the official plugins and
metamodels; add the analysis service with `-f docker-compose.yml -f docker-compose.plugins.yml`.
`docker compose up --build` builds the images from this checkout instead (it expects `linea-plugins` and `linea-metamodels` next to it).

## Use the pieces from npm

| Package | What | Install |
|---|---|---|
| [`@lbdudc/linea-cli`](packages/cli) | LINEA from the terminal (needs [Bun](https://bun.sh)) | `bunx @lbdudc/linea-cli` |
| [`@lbdudc/linea-core`](packages/core) | The engine: feature models, validation, derivation. Works offline. | `npm i @lbdudc/linea-core` |
| [`@lbdudc/linea-git`](packages/git) | One interface over the git hosts (local, GitLab, GitHub) | `npm i @lbdudc/linea-git` |
| [`@lbdudc/linea-ci`](packages/ci) | CI steps for lines and their products | `npx @lbdudc/linea-ci` |
| [`@lbdudc/linea-plugin-sdk`](packages/sdk) | Helpers for writing plugins | `npm i @lbdudc/linea-plugin-sdk` |

## Layout

```
packages/   core, git, cli, ci, sdk      published to npm, each with its own version
apps/       server, client               the web app (published as Docker images)
deploy/     docker-compose files, example configuration
docs/       architecture, plugin contract, API reference
e2e/        end-to-end suite (Chrome)
```

## Develop

Node 22 (see `.nvmrc`), and MongoDB as a replica set (`docker compose -f deploy/docker-compose.yml up mongo mongo-init-replica`).

```bash
npm install
npm run build        # core and git, which the apps use
npm test             # every workspace
npm run dev          # server + client
```

The plugins and the metamodels are other repositories. Check them out next to this one (`../linea-plugins`, `../linea-metamodels`), or
point `PLUGINS_DIR` and `LINEA_METAMODELS_DIR` at them; without them the tests that need them are skipped or can't build products.

## Release

Create a **GitHub Release** (tag `vX.Y.Z`, the tag is the version of every package). The *Release* workflow then publishes `@lbdudc/linea-core`, `-git`, `-cli`, `-ci` and `-plugin-sdk` to npm with that version (provenance, no token: npm trusted publishing), adds every commit since the previous tag to the release notes, and the *Docker* workflow publishes `ghcr.io/lbdudc/linea-server` and `linea-client` (amd64 and arm64). A tag like `v1.2.3-rc.1` is a prerelease: it goes to the `next` dist-tag. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE). © Laboratorio de Bases de Datos (LBD), Universidade da Coruña.
