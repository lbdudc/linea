# Modules, metamodels and models

An SPL can be **made of modules**. A module brings features, code and (optionally) models it offers; the **metamodels** it requires
define the languages (Langium grammars, managed with bango) in which a product writes its **models**. A product of an SPL gives one
model of **every** metamodel needed, directly or transitively, by **all** the SPL's modules. GitLab is the registry; LINEA keeps no
database of packages.

```
SPL ──uses──▶ Module ──requires──▶ Module
                 │  └──requires──▶ MetaModel ◀──instanceOf── Model ◀──provides── Product
                 └──────offers──▶ Model (read-only in the products)
```

## Repositories

A package is a GitLab project with the topic `linea-module` or `linea-metamodel`; its versions are its tags `vX.Y.Z`. Its location is
`gitlab:<path_with_namespace>`.

**The registry lives in GitLab, not in bango.** The metamodels (`LINEA/metamodels/<name>/`, a repository of their own: see its README) and sample modules (`LINEA/modules/<name>/`)
are folders, each one a package and one future repository. `server/scripts/publish-registry.mjs` publishes them to a group
(`<group>/metamodels/*`, `<group>/modules/*`, with topics and `vX.Y.Z` tags), and from then on the LINEA server reads them from GitLab
like it reads an SPL: it resolves versions from tags, reads the files at that tag, and sends the grammars to the client that edits models.

**Packages refer to each other by path**, as a folder: `../common` in `metamodels/basic` is its sibling `common`;
`../../metamodels/datamodel` in `modules/um` is the metamodel `datamodel` of the same group. An absolute location
(`gitlab:other/group/pkg`) also works. That is what lets the same set of repositories live under any group.

| | files |
|---|---|
| **metamodel** | `metamodel.json` `{name, version, description?, requires: {location: range}}` · `grammars/<name>.langium` (+ any library grammars) · `{constraints,specs,imports,scopes,visualizations}/<name>.js` · `cases/<name>.json` |
| **module** | `module.json` `{name, version, requires: {modules, metamodels}, offers: {metamodel: path}}` · `model.uvl` · `code/` · `extra.js` · `transformation.js` · `config.json` · `models/` |
| **SPL** | `spl.json` `{name, version?, modules: {location: range}}` · `linea.lock.json` · `src/platform/model.uvl` (the root feature) |
| **product** | `.linea/spec.draft.json` (saved) · `.linea/spec.json` (deployed) · `.linea/models/<metamodel>.<extension>` (on `main`) |

## The registry

By default every repository with the topic `linea-module` or `linea-metamodel` that the user can see is listed, so what a LINEA offers
depends on who looks. Set **`LINEA_REGISTRY`** (`gitlab:<group>/<repository>` or `github:<owner>/<repository>`) and the list becomes an
explicit **catalog**: a file `registry.json` on `main` of that repository, `{registryVersion: 1, packages: {location: {kind, name, description?, addedAt, addedBy?}}}`.
Registering or removing a package is a commit there, made with the user's own token, so the git host decides who may do it and its history is the history of the registry.

- **It only lists.** What an SPL may require is decided as before (`LINEA_TRUSTED_NAMESPACES`, and the sources that can be read): a package that is not registered can still be used, and removing one from the catalog does not delete or break anything.
- **Registering reads the package**: its latest version must have a valid `module.json` or `metamodel.json` (which says what kind it is, and gives the entry its name and description). A package without a published version cannot be registered; one made from LINEA can be registered at once (`register: true`).
- **An entry that cannot be reached** (deleted, private, its host down) is still listed, marked `unavailable`, so one broken entry does not hide the rest.
- **Suggestions**: the packages found by topic that are not registered yet, for the "Register a package" dialog.
- Without `LINEA_REGISTRY` nothing changes; the registry endpoints answer `409 registry_not_configured`.

Where it is: the interface (`PackageCatalog`), the index format, `registerPackage` / `registerLocation` and the memory and one-file catalogs are in
`packages/core/src/modules/registry` (no network); the catalog in a git repository, `listRegisteredPackages` and `suggestPackages` in `packages/git/src/registry/catalog.ts`;
`RegistryService` and `/api/registry` in the server; `linea registry list|add|remove` in the CLI. `server/scripts/publish-registry.mjs --registry <location>`
registers what it publishes (and makes the repository when it is missing); the dev stack does it, and `dev/up.sh` starts the server with `LINEA_REGISTRY`.

## The metamodel studio

A metamodel package opens in the **Studio** (a switch on its page; **Files** is the old file-by-file editor): bango's `@lbdudc/bango/studio` with the grammar and its four scripts in
editors that know the language (the script editors complete on the AST types of the grammar), the test cases and their results, the composed grammar, the grammar as a tree, a live **preview** of an
instance (text, form, diagram, JSON) and the metamodels it imports, read-only. The studio keeps nothing and knows nothing of git or versions: it is given files and reports what changed.

- `GET /api/packages/metamodel/:id/studio` gives the files of the package as they are on `main`, the metamodels its requirements resolve to (at their resolved versions), the path of each file and the problems of resolving (a requirement that is not published yet is reported, and the package can still be edited on its own).
- `GET /api/packages/:kind/:id/usage` gives the lines and projects (readable by the person) that use the package: `{location, lines: [{id, name, kind, direct, range, version, products}]}`, the range each asks for (`null` when the package comes in through another one) and the version its lock pins. `PUT /api/lines/:id/modules` takes `modules` (a modular line), `metamodels` (a project) or both, and `POST /api/lines/:id/modules/check` and `POST /api/migration/lines/:id/impact` take the same: that is how the package page, and the line's **Packages** section, show the changes and the products they would break before a version is pinned or updated.
- `PUT /api/packages/:kind/:id/files` `{files: {path: content | null}, message?}` saves every changed file in **one commit**; a manifest among them is checked first and nothing is written if anything is not valid.
- The studio composes in an engine **of its own** (a second worker): composing a metamodel there must not replace the composition of a product's models edited elsewhere.
- Check and publish are the ones of the page. Save first: publishing with unsaved changes asks.

## Rules

- Every package is used **once** (one version) in an SPL; versions are chosen like a package manager does (highest satisfying every
  range), the choices are pinned in `linea.lock.json`, and the lock is kept while it still fits.
- The feature models of the modules are grafted under the root of the SPL in a `mandatory` group (so every module is in every product, and its features are the options); the constraints of all of them are joined, and may tie features of different modules together, but each feature they name must be declared by some module or by the SPL; their code is laid over each other
  (two modules providing the same file with different content is an error); `extra.js` and `transformation.js` are chained after
  the core ones. A module registers what it needs from the models with `registerMetamodelProcessor(function (ret, input) {...})`:
  `input.models` is the merged JSON of the product's models (the metamodels' `*.spec.js` mappings) and `input.modelsByMetamodel`
  the JSON of each one (the mapping where there is one, otherwise the plain tree).
- A module's offered models are validated together with the product's: a product model can refer to `UM_User`, but cannot change it,
  and may not declare a name an offered model declares.
- Names are global: metamodel (grammar) names, feature names and the names of model elements must not collide across the packages of
  an SPL. Every problem is reported with the package and file at fault.

## Declaring what a module needs

A module says which **metamodels** it needs in its `module.json` (`requires.metamodels`), and which other modules (`requires.modules`).
The module page has a **Declaration** form for that (and for the models it offers), so nobody edits the JSON by hand.

An SPL made of modules is checked **only from its modules**: LINEA resolves them, reads the metamodels each one declares, composes all
of them with bango (grammars, imports, scripts), validates the models the modules offer together, and merges the feature models and code.
The SPL's **Modules** page shows the result module by module: the metamodels each brings (with versions), the modules it pulls in, and
the models it offers. If any of it does not fit, the SPL cannot be saved, and the report names the package and file at fault.

## The models of a product

In the product, the **Config. Modelos** tab lists the feature model and then one entry per metamodel its line's modules need. Choosing one
opens bango's own views (text with completion and problems, a form generated from the grammar, a diagram of the whole product, the
tree, the JSON of the model and of the whole product), with what the modules offer available read-only. One engine, in a worker of the
browser, serves all the models of the product, so they can refer to each other. **Guardar** commits the models to the product repository
and the server checks them again.

### Views a metamodel brings

Next to those views, a metamodel can bring views of its own, in `visualizations/<name>.js`: the data model brings a
**class diagram** (entities as UML classes, enumerations, inheritance, relationships with their multiplicities) and the sensors a **sensor
diagram** (sensors with their measurements and dimensions, ranges, groups, and the entities and map they use). They appear as one more tab
of that metamodel's model. Both draw on bango's canvas: drag a node, drag from the dot at its side onto another to relate them, select one to
edit it in the panel at the side, `Delete` removes it, and every change is a change of the text of the model, so the usual checks apply.

- **Nothing of them is in this client.** LINEA used to have a class-diagram editor and a sensor editor of its own for the classic kind of SPL
  (they kept a JointJS drawing and a sensor DSL in the product); they were removed, and a classic SPL is now a feature model and nothing else.
  A product made that way keeps what it stored (`dataModel`, `sensor`), and still generates from it, but there is nothing to edit it with here;
  the way forward is an SPL made of modules, whose data model and sensors are metamodels like the rest.
- **Where the nodes are** is saved with the product, in `.linea/layouts.json` of its repository (`{ metamodel: { view: { node: { x, y } } } }`), in the
  same commit as the model when both changed (`PUT /api/products/:id/models/:metamodel` with `layouts`), or alone (`PUT /api/products/:id/layouts`).
  The server keeps only what is a position of a node of a metamodel the product has, and refuses a large body.
- **They run in the browser, not in the server.** The server only carries them (`bundle.visualizations` in the overview of the models, and the
  studio's *Visualizations* tab to write them). They are as trusted as the metamodel's scripts, which run unsandboxed in the server and in the
  engine's worker: `LINEA_TRUSTED_NAMESPACES` decides which git groups a package may come from.

## Where it lives

| | |
|---|---|
| `bango` | metamodels and models; `setContributed` for read-only models; the views a metamodel brings (`@lbdudc/bango/renderer` runs them). Its prebuilt bundles are served by the client (`client/public/bango`) |
| `LINEA/metamodels`, `LINEA/modules` | the registry as folders, published to GitLab with `server/scripts/publish-registry.mjs` |
| `packages/core/src/modules` | no network: it is given a `PackageSource` and a metamodel engine. `packages/` manifests, locations, sources · `registry/` one registry per kind (modules, metamodels) and a router that sends each location to its host · `resolution/` one resolver per registry (modules, then the metamodels they declare) and the lockfile · `metamodels/` loading the metamodels into bango, offered models · `spl/` composing the feature model and code, `checkSpl` · `products/` product check, seed and derivation |
| `packages/git` | the git host (GitLab or GitHub): the provider, the registry of modules and metamodels (list, create, publish, the catalog in a repository), the `PackageSource`s linea-core reads from. Used by the server and the CLI. See [git-provider.md](git-provider.md) |
| `apps/server/src/model/services/modules` | who may do what (`PackageService`), lines and products (`ModularService`), the check of a package (`packageCheck`), over the library |
| `bango/packages/studio` (`@lbdudc/bango/studio`) |  the metamodel studio, plain DOM, given Monaco, the engine and the renderer by the page (see bango's `docs/embedding.md`) |
| `apps/client` | `pages/modules/` and `components/modules/`: **Modules** and **Metamodels** (one page each, at `/packages/modules` and `/packages/metamodels`; `/modules` redirects: the registry: register, remove, suggestions; a package's declaration form, **studio**, files and release), the module picker (used when creating an SPL and in its **Módulos** tab), the **Config. Modelos** tab of a product |
| `linea-cli` | the terminal side. Everything is folders: `get` brings an SPL and its products from LINEA as git clones (and updates them), `push` checks, commits and opens the merge/pull request (uploading an SPL made locally first), `spl new` and `product new` make things on LINEA and bring them to your folder (`--local` keeps them here); `spl …`, `product …`, `fm …`, `module …`, `metamodel …`, `check` and `generate` work on those folders; `generate --remote` is the one that has LINEA derive a product. `open` starts your editor on any of it. See [linea-cli/README.md](../../linea-cli/README.md) |

API: `GET|POST /api/packages/:kind`, `GET /api/packages/:kind/:id`, `GET|PUT|DELETE …/file`, `PUT …/files`, `GET …/studio`, `POST …/check`, `POST …/publish`;
`GET /api/registry/status`, `GET|POST|DELETE /api/registry`, `GET /api/registry/suggestions`;
`GET|PUT /api/lines/:id/modules`, `POST /api/lines/:id/modules/check`; `GET /api/products/:id/models`,
`PUT /api/products/:id/models/:metamodel`, `PUT /api/products/:id/layouts`, `POST /api/products/:id/models/check`.

Not done yet: migrating a product's models when a metamodel changes its major version; converting an existing plain SPL to modules;
the project-wide diagram of bango uses its built-in layered layout (it can use elkjs when that is bundled), and the layout of the diagrams a metamodel brings is a plain one that people then adjust.
