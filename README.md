<p align="center">
  <img src="https://raw.githubusercontent.com/lbdudc/linea-web/main/src/assets/logo.svg" alt="LINEA" height="72">
</p>

<h3 align="center">Lifecycle management for software product lines</h3>

<p align="center">
  Model a product line once. Derive a product for every customer. Keep all of them alive in git.
</p>

<p align="center">
  <a href="https://github.com/lbdudc/linea/actions/workflows/ci.yml"><img src="https://github.com/lbdudc/linea/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@lbdudc/linea-cli"><img src="https://img.shields.io/npm/v/@lbdudc/linea-cli?label=%40lbdudc%2Flinea-cli" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="license"></a>
</p>

<p align="center">
  <a href="https://lbdudc.github.io/linea-web/"><b>Documentation</b></a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#linea-cli">CLI</a> ·
  <a href="https://github.com/lbdudc/linea-plugins">Plugins</a> ·
  <a href="https://github.com/lbdudc/linea-metamodels">Metamodels</a> ·
  <a href="https://github.com/lbdudc/linea/releases">Releases</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/lbdudc/linea-web/main/src/assets/screens/lines-products-dark.jpg">
    <img src="https://raw.githubusercontent.com/lbdudc/linea-web/main/src/assets/screens/lines-products-light.jpg" alt="LINEA: a product line and the products derived from it" width="860">
  </picture>
</p>

---

## Contents

- [What is LINEA?](#what-is-linea)
- [Core concepts](#core-concepts)
- [Quick start](#quick-start)
- [The web application](#the-web-application)
- [LINEA CLI](#linea-cli)
- [Feature models](#feature-models)
- [Modules](#modules)
- [Metamodels and models](#metamodels-and-models)
- [Three kinds of line](#three-kinds-of-line)
- [How a product is generated](#how-a-product-is-generated)
- [Git hosts](#git-hosts)
- [Plugins](#plugins)
- [Packages on npm](#packages-on-npm)
- [Repositories](#repositories)
- [Develop](#develop) · [Release](#release) · [License](#license)

## What is LINEA?

When one organisation builds similar applications for many customers there are two ways to go:

- **Clone the project** for each customer. Fast at first, but every fix must be copied by hand into every clone, and the cost grows with each variant.
- **Build a product line.** Keep one set of assets that contains everything any customer might need, mark which feature each piece belongs to, and *derive* each customer's application by choosing features.

LINEA is the tool for the second way. It stores the line, validates the feature model, lets you pick features for a product, generates the product's code into its own git repository, and then keeps line and products in step as both evolve: branches, merge requests, CI pipelines, versions, conflicts and deployments.

It applies the ideas of *Application Lifecycle Management* (ALM) to **software product lines (SPL)**, joining the lifecycle of the line with the lifecycles of its products.

**What you get**

- A **web application** to manage lines and products, edit feature models and models, generate, sync and deploy.
- A **CLI** (`linea`) that does the same from a terminal and lets you work on lines, products, modules and metamodels as ordinary git clones in your editor.
- **Reusable modules and metamodels**, published to a registry, so a new line is mostly *assembled* instead of written.
- A **git-native** workflow: lines and products are repositories on the host you already use (GitLab, GitHub, or LINEA's own built-in host).
- A **plugin system** for analysis, AI agents, code editors and more.

## Core concepts

| Concept | What it is |
|---|---|
| **Feature** | A property a product may include or omit: "maps", "payments", "user accounts". |
| **Feature model** | A tree of features plus the constraints between them. It defines every valid product. Written in [UVL](https://www.uvlhub.io/). |
| **Line (SPL)** | A repository with everything needed to generate products: the feature model, the modules it uses and, depending on its kind, platform code. |
| **Product** | An application derived from a line with one selection of features. It has its own repository. |
| **Module** | A reusable package of features, code and (optionally) models that a line can incorporate. |
| **Metamodel** | The formal definition (a grammar) of a *kind* of model: data model, menus, forms, GIS... |
| **Model** | A document written in the language of a metamodel. Each product has its own; they are the input of generation. |
| **Generation** | Turning the line's assets plus a product's feature selection and models into real code in the product's repository. |

```
Line ──uses──▶ Module ──requires──▶ Module
                 │  └────requires──▶ Metamodel ◀──instance of── Model ◀──owned by── Product
                 └──────offers────▶ Model (read-only in products)
```

## Quick start

LINEA keeps its repositories itself (the built-in `local` git host), so a first try needs neither GitLab nor GitHub.

You need [Docker](https://docs.docker.com/get-docker/) with Compose v2.

```bash
git clone --depth 1 https://github.com/lbdudc/linea && linea/deploy/install.sh
```

The script writes `deploy/.env` with fresh secrets, pulls the images, starts everything and prints the administrator password. Open
**http://localhost:9000** and sign in as `admin`.

Then, in the web application:

1. **Create a line.** Pick *Modular* (recommended) or *Simple SPL* for a first try.
2. **Edit the feature model** (or, for a modular line, choose modules and let the model be composed).
3. **Create a product** and select its features.
4. **Generate.** The code lands in the product's own repository, with a merge request and a CI pipeline.

The [quick start guide](https://lbdudc.github.io/linea-web/get-started/quickstart/) walks through it with screenshots.

<details>
<summary><b>Configuration, versions and updates</b></summary>

Run `install.sh` again to update (it keeps your `.env`). By hand: `cp deploy/.env.example deploy/.env`, set `JWT_SIGN_KEY` and `LINEA_ADMIN_PASSWORD`, then `docker compose up -d` from `deploy/`.

The stack pulls MongoDB, a reverse proxy and two public images for amd64 and arm64:

| Image | What |
|---|---|
| `ghcr.io/lbdudc/linea-server` | API, built-in git host, generation; carries the official plugins and the metamodels |
| `ghcr.io/lbdudc/linea-client` | the web interface (built with the plugins' client code) |

Tags are the release versions (`0.2.2`, `0.2`, `latest`; [all releases](https://github.com/lbdudc/linea/releases)). Pin one with `LINEA_VERSION=0.2.2 ./install.sh` or in `deploy/.env`. To update: `docker compose pull && docker compose up -d`.

| Setting (`deploy/.env`) | Default | What |
|---|---|---|
| `JWT_SIGN_KEY` | *(required)* | signs sessions: a long random string (`openssl rand -hex 32`) |
| `ADMIN_USERS`, `LINEA_ADMIN_PASSWORD` | `admin` / placeholder | the first administrator of the `local` host |
| `PROXY_PORT`, `REDIRECT_URI` | `9000`, `http://localhost:9000` | where LINEA is served; set both for another port or a public address |
| `LINEA_VERSION` | `latest` | tag of the images |
| `LINEA_CONFIG_DIR` | `./config` | folder with a `linea.config.yml` (git hosts, plugins): see `linea.config.example.yml` |
| `LINEA_REGISTRY` | `local:registry/index` | where the metamodels are published at start |

The analysis service of the analytics plugin runs with `docker compose -f docker-compose.yml -f docker-compose.plugins.yml up -d`. To run a change you made: `docker compose up -d --build` (the build expects `linea-plugins` and `linea-metamodels` checked out next to this repository).

For a public deployment read the [production checklist](https://lbdudc.github.io/linea-web/configure/production-checklist/).

</details>

## The web application

The web interface is where most people live: lines and products at a glance, feature models, models, generation, sync, CI/CD runs and deployments.

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/lbdudc/linea-web/main/src/assets/screens/feature-model-dark.jpg">
        <img src="https://raw.githubusercontent.com/lbdudc/linea-web/main/src/assets/screens/feature-model-light.jpg" alt="Feature model editor">
      </picture>
      <sub><b>Feature model.</b> Edit as text, tree, XML or form; constraints are checked as you type.</sub>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/lbdudc/linea-web/main/src/assets/screens/feature-selection-dark.jpg">
        <img src="https://raw.githubusercontent.com/lbdudc/linea-web/main/src/assets/screens/feature-selection-light.jpg" alt="Selecting features for a product">
      </picture>
      <sub><b>Feature selection.</b> Pick the features of a product; invalid combinations are explained.</sub>
    </td>
  </tr>
  <tr>
    <td>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/lbdudc/linea-web/main/src/assets/screens/line-modules-dark.jpg">
        <img src="https://raw.githubusercontent.com/lbdudc/linea-web/main/src/assets/screens/line-modules-light.jpg" alt="Modules of a line">
      </picture>
      <sub><b>Modules.</b> The packages a line uses, their versions and what they bring.</sub>
    </td>
    <td>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/lbdudc/linea-web/main/src/assets/screens/registry-dark.jpg">
        <img src="https://raw.githubusercontent.com/lbdudc/linea-web/main/src/assets/screens/registry-light.jpg" alt="Package registry">
      </picture>
      <sub><b>Registry.</b> The catalog of modules and metamodels you can use.</sub>
    </td>
  </tr>
</table>

What you can do there:

- **Lines and products:** create, browse and configure them; see each one's repository, merge requests and pipelines.
- **Editors:** the feature model (UVL text, tree, XML, form) and every model of a product, with text, form and diagram views and live validation against the metamodel.
- **Generation:** derive a product, preview the diff, queue and cancel runs, read the log, and publish the result as a new version.
- **Sync:** bring the changes of the line into its products; conflicts between generated code and manual edits are shown and can be resolved.
- **CI/CD and deployments:** pipeline status, generation and sync history, scheduled syncs.
- **Packages:** browse, publish and version modules and metamodels; see which lines and products use each one.
- **Administration:** git hosts, users and admins, plugins and instance settings ([configuration guide](https://lbdudc.github.io/linea-web/configure/overview/)).

## LINEA CLI

`linea` is the terminal side of LINEA. It does what the web interface does, and it also lets you **take lines, products, modules and metamodels onto your machine** as real git clones, work on them in your editor and send the changes back.

```bash
bun add -g @lbdudc/linea-cli      # needs Bun and git; or: bunx @lbdudc/linea-cli

linea login                       # once: the server and your git host
linea get gis-apps                # the line and its products, as git clones (again later: updates them)
cd ~/linea/gis-apps
linea open                        # VS Code with the line and the modules it uses
linea check                       # do the modules fit? do the products' models?
linea push -m "Add reports"       # checks, commits, pushes a branch, opens the merge/pull request
linea open --web                  # the same line in the web interface
```

Run `linea` alone to open an interactive window with the same commands.

| You… | Typical session |
|---|---|
| **develop a line** | `get gis-apps` → `cd` → `open` → edit → `check` → `push` |
| **configure products** | `product new shop --features A,B` → `open shop:datamodel` → `check shop` → `generate shop` |
| **write modules or metamodels** | `module new auth` → edit → `check auth` → `module publish auth --bump minor --to my-group` |
| **use LINEA from CI** | `linea --json check` (exit code 1 when something does not fit) |
| **start on your laptop** | `spl new gis --local` → `spl add github:acme/auth` → `push` (uploads it when you are ready) |

Two verbs move things between LINEA and your machine: **`get`** brings things down, **`push`** sends them up. Like `git`, a command acts on the folder you are in: inside a product it is about that product, inside a line about the line, inside a module about that module.

Full reference: [`packages/cli`](packages/cli) and `linea help`.

## Feature models

A feature model says which features a line has and which combinations are valid. LINEA reads and writes it in **UVL** (Universal Variability Language), and shows it as text, tree diagram, XML or form.

```text
features
    Shop
        mandatory
            Catalog
        optional
            Account
            Maps
            Payments
                or
                    Card
                    Transfer
            Reports

constraints
    Payments => Account
```

| Keyword | Meaning |
|---|---|
| `mandatory` | in every product |
| `optional` | a product may include it or not |
| `or` | at least one child must be selected |
| `alternative` | exactly one child must be selected |
| `constraints` | logic rules between features anywhere in the tree (`A => B`, `A & B`, `A \| B`, `!A`) |

A product is a **valid selection**: it respects the tree and every constraint. In the web application and in `linea check`, an invalid selection is rejected and the broken constraint is named. The [analytics plugin](#plugins) goes further with [flamapy](https://www.flamapy.org/): core and dead features, satisfiability and the number of possible products.

Feature selection drives the code: code in a line is annotated with conditions on features and only the code of the selected features reaches the product.

```js
/*% if (feature.Maps) { %*/
import { MapView } from './map';
/*% } %*/
```

## Modules

A **module** is a reusable package that gives a line a complete piece of functionality: user management, a map viewer, data browsing, sensors. A *modular* line is built by choosing modules instead of writing the platform code.

```
my-module/
├── .linea/
│   ├── module.json            name, version, requires, offers
│   ├── model.uvl              the features it adds to the line's tree
│   └── config/                config.json, extra.js, transformation.js
├── code/                      application code, annotated with feature conditions
└── models/                    models it offers, ready-made (optional)
```

```json
{
  "name": "user-management-component",
  "version": "0.4.0",
  "requires": {
    "modules": { "gitlab:acme/modules/main-component": "^0.4.0" },
    "metamodels": { "../../metamodels/security": "^1.0.0" }
  },
  "offers": {}
}
```

When a line uses modules, LINEA:

1. **Resolves versions** like a package manager (highest version that satisfies every range) and pins them in `linea.lock.json`.
2. **Grafts** each module's feature model under the line's root, joins the constraints and checks them.
3. **Overlays** the modules' code (two modules giving the same file with different content is an error).
4. **Chains** the modules' scripts and merges the models they offer.

Modules live in git repositories (a tag `vX.Y.Z` is a version) and are published with `linea module publish` or from the web application. The format is documented in depth in [docs/modules.md](docs/modules.md).

## Metamodels and models

A **metamodel** defines a modelling language, as a [Langium](https://langium.org/) grammar. A **model** is a document in that language. Products are described by models, and the code is generated from them. LINEA validates every model against its metamodel and gives you text, form and diagram editors for it.

```text
// a product's data model (datamodel)
entity Road {
  property name: String required pk
}
```

A metamodel is a package with a manifest, a grammar and four scripts:

| File | Role |
|---|---|
| `metamodel.json` | name, version, dependencies |
| `grammars/<name>.langium` | the syntax |
| `constraints/<name>.js` | validations the grammar cannot express (errors and warnings) |
| `specs/<name>.js` | turns the model into the JSON specification the templates read |
| `imports/<name>.js` | the inverse: builds the model from the specification |
| `scopes/<name>.js` · `visualizations/<name>.js` | reference scoping and custom diagrams |
| `cases/<name>.json` | test cases: input text and expected diagnostics |

The official metamodels, in [`lbdudc/linea-metamodels`](https://github.com/lbdudc/linea-metamodels):

| Metamodel | Describes |
|---|---|
| `featuremodel` | the feature tree of a line |
| `basic` | name, version, SRID, languages, package, database and deployment settings |
| `datamodel` | entities, property and relationship fields, enumerations, inheritance |
| `lists` · `forms` · `browser` | tables and data-entry forms over entities |
| `menus` · `gui` · `statics` | navigation, look and feel, static pages |
| `gismodel` | maps, layers and styles |
| `sensors` | sensors, measurements and dimensions |
| `security` | users, roles and what each may do |
| `common` | shared terminals and types (a library) |

A product gives **one model of every metamodel** its line needs. The **metamodel studio** in the web application edits a metamodel with its grammar, scripts, test cases and a live preview of an instance.

## Three kinds of line

| | Simple SPL | Project | Modular |
|---|---|---|---|
| `kind` | `plain` | `project` | `modular` |
| Feature model | you write it | you write it | **composed** from modules |
| Platform code | you write it | you write it | **taken from modules** |
| Metamodels | only `featuremodel` | you choose | loaded for you |
| Product models | feature selection | selection + your models | selection + modules' models |
| Best for | learning, trials | own models, no modules | **reuse (recommended)** |

All three generate products in the same way. See [line types](https://lbdudc.github.io/linea-web/concepts/line-types/).

## How a product is generated

```
feature selection ─┐
                   ├─▶  validate ─▶ resolve ─▶ generate ─▶ product repo (branch bigbang) ─▶ merge request ─▶ main
product models ────┤      FM +       modules     templates                                       + CI pipeline
line / modules ────┘      models                + code
```

1. **Validate** the selection against the feature model and the models against their metamodels.
2. **Compose** the line: resolve modules, graft feature models, overlay code, chain scripts.
3. **Generate** the product from the specification (selection plus models), keeping only the code of selected features.
4. **Deliver** to a dedicated `bigbang` branch of the product's repository and open a merge request into `main`.

Because generated code arrives on its own branch, manual edits on `main` and newer generated code meet in an ordinary merge: when they conflict LINEA shows it and helps you resolve it, and your changes are never silently overwritten. Every generation is a version of the product; you can compare two and roll back.

## Git hosts

Lines, products, modules and metamodels are plain git repositories. LINEA talks to them through one interface, so you choose where they live:

| Host | Use it when |
|---|---|
| **`local`** (built in) | trying LINEA, demos, air-gapped installs: no external account needed |
| **GitLab** | self-hosted or gitlab.com, with OAuth sign-in |
| **GitHub** | github.com or Enterprise, with OAuth sign-in |

They are configured in `linea.config.yml` (see [`deploy/linea.config.example.yml`](deploy/linea.config.example.yml)); one remote is active at a time. Guides: [git hosts](https://lbdudc.github.io/linea-web/configure/git-hosts/), [GitLab OAuth](https://lbdudc.github.io/linea-web/configure/gitlab-oauth/), [GitHub OAuth](https://lbdudc.github.io/linea-web/configure/github-oauth/).

## Plugins

The core does lines, products, modules and generation. Everything else is a plugin, from [`lbdudc/linea-plugins`](https://github.com/lbdudc/linea-plugins):

| Plugin | What it does |
|---|---|
| **Feature model analysis** | analyses the model with flamapy: core and dead features, satisfiability, number of products |
| **AI agents** | sync-conflict resolver, line health review, evolution suggestions |
| **SPL code editor** | edit the line's code in the browser |
| **MCP** | exposes LINEA to MCP clients (AI assistants) |

Writing your own: [plugin contract](docs/linea/plugins.md), [`@lbdudc/linea-plugin-sdk`](packages/sdk).

## Packages on npm

All five share one version (the release tag) and are published with provenance.

| Package | What | Use it |
|---|---|---|
| [`@lbdudc/linea-cli`](packages/cli) | LINEA from the terminal (needs [Bun](https://bun.sh)) | `bunx @lbdudc/linea-cli` |
| [`@lbdudc/linea-core`](packages/core) | The engine: feature models, validation, composition, derivation. Works offline | `npm i @lbdudc/linea-core` |
| [`@lbdudc/linea-git`](packages/git) | One interface over the git hosts (local, GitLab, GitHub) | `npm i @lbdudc/linea-git` |
| [`@lbdudc/linea-ci`](packages/ci) | CI steps for lines and their products | `npx @lbdudc/linea-ci` |
| [`@lbdudc/linea-plugin-sdk`](packages/sdk) | Helpers for writing plugins | `npm i @lbdudc/linea-plugin-sdk` |

## Repositories

| Repository | Contents |
|---|---|
| [`lbdudc/linea`](https://github.com/lbdudc/linea) (this one) | server, web client, CLI, core, git, ci and sdk packages, deployment |
| [`lbdudc/linea-plugins`](https://github.com/lbdudc/linea-plugins) | official plugins and the marketplace manifest |
| [`lbdudc/linea-metamodels`](https://github.com/lbdudc/linea-metamodels) | official metamodels |
| [`lbdudc/linea-web`](https://github.com/lbdudc/linea-web) | the website and documentation |

```
packages/   core, git, cli, ci, sdk      published to npm
apps/       server, client               the web app (published as Docker images)
deploy/     Compose files and example configuration
docs/       architecture, plugin contract, API reference
e2e/        end-to-end suite (Chrome)
scripts/    release helpers
```

Architecture: [docs/linea/architecture.md](docs/linea/architecture.md) · REST API: [docs/linea/api-reference.md](docs/linea/api-reference.md). The line between core and plugins is enforced by `apps/server/src/test/boundary.test.js`.

## Develop

Node 22 (see `.nvmrc`) and MongoDB as a replica set (`docker compose -f deploy/docker-compose.yml up -d mongo mongo-init-replica`).

```bash
npm install
npm run build        # core and git, which the apps use
npm test             # core, git, ci, cli (needs Bun), server and client
npm run dev          # server + client
```

The plugins and the metamodels are other repositories. Check them out next to this one (`../linea-plugins`, `../linea-metamodels`), or point `PLUGINS_DIR` and `LINEA_METAMODELS_DIR` at them.

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Release

Create a **GitHub Release** with a tag `vX.Y.Z`: that tag is the version of every package. The *Release* workflow publishes the five npm packages (npm trusted publishing, no token) and adds every commit since the previous tag to the release notes; the *Docker* workflow publishes the two images. A tag like `v1.2.3-rc.1` is a prerelease and goes to the `next` dist-tag. Details in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE). © Laboratorio de Bases de Datos (LBD), Universidade da Coruña.
