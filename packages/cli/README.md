# linea-cli

The terminal side of LINEA. It does what the web interface does, and it also lets you **take SPLs, products, modules and metamodels
onto your machine**, work on them in your editor, and send the changes back.

```bash
linea login                       # once: the server and your git host (GitLab or GitHub)
linea get gis-apps                # the SPL and its products, as real git clones (again later: updates them)
cd ~/linea/gis-apps
linea open                        # VS Code, with the SPL and the modules it uses
linea check                       # do the modules fit? do the products' models?
linea push -m "Add reports"       # checks, commits, pushes a branch and opens the merge/pull request
linea open --web                  # the same SPL in the web interface
```

Every command works in two ways, with the same words: as `linea <command>` in a shell (scripts, CI), and as `<command>` (or
`/<command>`) in the interactive window that `linea` alone opens.

## Install

Requires [Bun](https://bun.sh) and `git`.

```bash
cd linea-core && bun link               # one-time per machine: the CLI uses the library from this checkout
cd ../linea-cli && bun install && bun run build
```

To type `linea` from anywhere, make it a command of your shell that runs the bundle with Bun (`bun link` alone does not do that):

```powershell
# PowerShell, once:
Add-Content $PROFILE 'function linea { bun --no-env-file C:\path\to\linea-cli\dist\index.js @args }'
```
```bash
# bash/zsh, once:
echo 'linea() { bun --no-env-file /path/to/linea-cli/dist/index.js "$@"; }' >> ~/.bashrc
```

(`dist/index.js` needs Bun, not Node.)

`bun run build` makes `dist/index.js`, which is what `linea` runs: it works from **any folder** (running `src/index.tsx` directly
needs this folder's `bunfig.toml`, so only do that to develop the CLI: `bun run dev`).

`linea doctor` says whether everything is in place: git, the workspace, an editor, the git host and, with `--online`, the server.

## Who does what

| You… | Typical session |
|---|---|
| **develop an SPL** | `get gis-apps` → `cd` → `open` → edit → `check` → `push` |
| **configure products** | `product new shop --features A,B` → `product show shop` → `open shop:datamodel` → `check shop` → `generate shop` |
| **write modules or metamodels** | `module new auth` → edit → `check auth` → `module publish auth --bump minor --to my-group`; to change one that exists: `get github:acme/auth` |
| **use LINEA from CI** | `linea --json check` (exit code 1 when something does not fit) |
| **start on your laptop** | `spl new gis --local` → `module list --remote` → `spl add github:acme/auth` → `push` (uploads it to LINEA when you are ready) |

## Where you are decides what is meant

Like `git`, a command acts on what the current folder is:

- inside a **product** (`gis-apps/shop`): `check`, `generate`, `product show`, `open`… are about that product;
- inside an **SPL** (`gis-apps`): about the SPL, and `status`, `get`, `push` also take its products along;
- inside a **module or metamodel** folder: `check`, `module publish`… are about that package.

Anywhere else, name what you mean (`check shop`, `open auth`, `product show shop`), or move there: in a shell with your own `cd`, in the
window with `cd <spl>` (`cd gis-apps`, `cd shop`: the names, not paths).

A **workspace** is a folder (`linea init`) with `modules/` and `metamodels/` next to your SPLs, the way the modules an SPL uses are looked
for. `linea config workspace <folder>` sets the default one; standing in a workspace uses it.

## Between LINEA and your machine: two verbs

- **`get`** brings things down: `get gis-apps` clones the SPL and its products; if you already have them it updates them (`get` on its own,
  inside an SPL, updates that SPL and its products; in your workspace, all of them).
- **`push`** sends things up: it checks, commits, pushes a branch and opens the merge/pull request. If the SPL was made here and LINEA
  does not have it yet, `push` uploads it first.

And what you create goes where you are working: signed in, `spl new` makes the SPL **on LINEA and brings it to your folder**, and
`product new`, inside an SPL that is on LINEA, makes the product there and brings it into the SPL's folder. `--local` makes it only
here (`push` will upload it later). `spl list` shows both sides in one list: *here + LINEA*, *here only*, *LINEA only*.

There is no mode to think about: a command acts on the folder you are in, and goes to LINEA only when it has to (`get`, `push`, `spl list`,
`spl new`, `product new`, `generate --remote`, and the few commands that only exist there: `product logs`, `product conflicts`,
`reconcile`, `namespaces`). `--local` means "do not talk to the server" for one command.

Changing something that LINEA has is always the same loop: `get` it, change it in your folder, `push` it. That is why there is no
`rename`, `delete` or `update` of things on the server from here: do those in the web interface, and `get` the result.

## Configuration

| | Default | Purpose |
|---|---|---|
| `LINEA_BASE_URL` / `config server <url>` | `http://localhost:3000` | the LINEA server |
| `config workspace <folder>` | OS data folder | where SPLs, modules and metamodels live |
| `config editor <command>` | `$VISUAL`, `$EDITOR`, then `code`, `cursor`, `codium`, `windsurf` | what `open` starts |
| `config theme <name>` / `LINEA_THEME` | `linea` | the colours of the window: `linea` (the web interface, dark), `linea-light`, `ember` (orange on neutral dark), `mono`; `config theme` lists them. Applies the next time `linea` opens |
| `GITLAB_TOKEN` / `GITHUB_TOKEN` / `LINEA_GIT_TOKEN`, `GIT_PROVIDER`, `GITLAB_HOSTNAME`… | from `login` | the git host, when you work without the server |
| `LINEA_TRUSTED_NAMESPACES` | anywhere | where modules and metamodels may come from (they carry scripts that run here) |
| `LINEA_REGISTRY` | unset | the repository with the catalog of registered modules and metamodels (`gitlab:group/repo`, `github:owner/repo`): `module list --remote` shows what is registered there (otherwise every repository with the topic); `registry list/add/remove` manage it. It only lists: it does not limit what an SPL may use |
| `LINEA_TOKEN` | – | a development JWT that replaces `login` |
| `LINEA_OAUTH_PORT` | `53682` | the port `login` listens on (it has to be registered as a redirect URI) |
| `LINEA_DEBUG` | unset | `1`: the git credential helper writes one line per request to `~/.linea/credential.log` (host, answered or not; never the token) |
| `LINEA_HOME` | `~` | where `.linea/credentials.json` is kept (mode 0600) |

Bun reads a `.env` in the folder you start from; `bun --no-env-file` ignores it.

## Signing in

`linea login` opens your browser on the git host (the same OAuth the web interface uses), and when it comes back the CLI has
**both** things it needs: a session on the LINEA server, and your own access to the git host, which the server hands over once
(`/api/users/git-credentials`). Nothing else is to be set up.

If your LINEA server is older and gives no git access (`whoami` shows `git access: none`), or you would rather use your own, give a
**personal access token** for your git host (GitLab: scope `api`; GitHub: `repo`): `linea login --token <token or path of a file
holding it>`. The host is the one the server says it is on; it is asked whether it accepts the token before it is kept, the token is
never printed, and it is kept over whatever the server says later. Git access belongs to the server it came from: switching servers
(`config server …`) leaves the other's behind, and `doctor` says where the access in use comes from.

The access is also what `git` uses: a clone is configured with `linea` as its credential helper for that host, so a plain `git push`
or `git pull` inside it works too, and no token is written into any repository.

## Commands

`linea help` lists them, `linea help <command>` explains one (`help product`, `help spl new`).
Anything marked `local` or `cloud` works only there.

### Get started

| | |
|---|---|
| `login`, `logout`, `whoami` | the server and the git host (cloud) |
| `config [workspace\|editor\|server] [value]` | the settings |
| `init [folder]` | make a folder a workspace |
| `cd [name]` | in the window: move into an SPL, a product, a module or a metamodel **by its name** (a product of the SPL you are in first, then an SPL of your workspace); `cd ..` goes up, `cd` alone to the workspace. Tab completes the names. A shell has its own `cd` |
| `doctor [--online]` | check that everything is in place |

### LINEA ⇄ your machine

| | |
|---|---|
| `get [spl[:product]] [--products all\|none\|a,b] [--dir folder]` | bring an SPL and its products (real git clones; the products sit inside the SPL's folder), or update what you have. Tab after `get ` completes the SPLs LINEA has, marking which you already have |
| `status [--fetch]` | branch, changes and what to push or get, for the SPL and each product |
| `push [-m message] [--direct] [--no-check]` | check, commit, push a branch `linea/<you>/<what>` and open the merge/pull request. An SPL made here is uploaded first. `--direct` pushes to the default branch |
| `open [what] [--editor name] [--print]` | the SPL (as a VS Code workspace with its modules), a product, `shop:datamodel`, `fm`, a module, a path |
| `open --web`, `open --repo` | the same thing in the LINEA web interface, or on the GitLab/GitHub page |

Some commands were folded into others and no longer appear in `help`, but still work: `clone`, `pull` and `link` are `get` and `push`; `web` and `repo` are `open --web` and `--repo`; `spl modules` is in `spl show`; `product models` and `product conflicts` are in `product show`; `fm edit` is `open fm`; `module clone` is `get gitlab:group/project`.

### SPLs, the feature model and products

| | |
|---|---|
| `spl list`, `spl show [spl]` | your SPLs, here and on LINEA in one list, coloured by where each is (green: here and on LINEA, yellow: only here, cyan: only on LINEA); what one is made of (for one of modules: the modules it names and what they bring in), its products, and whether LINEA has it |
| `spl new <name> [--modules gitlab:g/m,…] [--plain] [--local]` | made of modules by default; `--plain` is the classic kind (a feature model and nothing else: the data model and the sensors are metamodels of modules). Signed in it is made on LINEA and comes to your folder; `--local` keeps it here |
| `spl add <module> [range]`, `spl remove <module>` | choose the modules; what they need comes with them |
| `spl update [module]` | take the newest versions the ranges allow and pin them in `linea.lock.json` |
| `spl delete <spl> --yes` | delete it from this machine (irreversible, products included); LINEA keeps its own copy |
| `check [product\|module\|metamodel]` | an SPL (its modules fit), a product (its models and features fit) or a package, by what you name or where you are |
| `fm show\|convert\|analyze\|metric` | the feature model (to change it: `open fm`) |
| `product new <name> [--features A,B] [--from spec.json] [--local]` | a product; in an SPL that is on LINEA it is made there and comes into the folder. For an SPL of modules it starts with a model of each metamodel it needs |
| `product list\|show\|rename\|delete` | the products of the SPL you are in (here, on this machine); `show` has its features, its models and what is missing, and the merge requests LINEA knows of |
| `product features <product> [--add A,B] [--remove C]` | the features a product selects |
| `generate [product] [--preview [dir]] [--zip [file]] [--remote [--bump patch\|minor\|major] [--no-wait]]` | derive it here, into the product's folder (then `push`); `--preview` and `--zip` leave it alone; `--remote` has LINEA derive it, open its merge requests and follow its pipeline (`--no-wait` does not) |
| `product pipeline [product] [--retry] [--watch]` | the pipeline of the last commit on LINEA: its jobs, and what the failed one printed; `--retry` runs the failed jobs again |
| `product changes [product] [version]` | what a version changed in its specification against the one before it |
| `product deployment [product]` | what is saved on LINEA that no generation has put in the code yet |
| `product rollback <version> [product] [--no-generate]` | go back to the content of an earlier version: restored, and generated on LINEA as a new version |

### Modules and metamodels (the same verbs for both)

| | |
|---|---|
| `module list [search] [--remote]` | those of your workspace, or on your git host |
| `module show <name\|location>` | versions, what it requires and offers, and which SPLs use it |
| `module new <name>` | make one in your workspace |
| `get gitlab:group/project \| github:owner/repo` | get one of the host to change it (a module or a metamodel, whichever it is) |
| `module check [name]` | check it on its own, as the registry does before publishing |
| `module publish [name] [--bump patch\|minor\|major] [--to group-or-owner] [--dry-run]` | check, raise the version, and publish it as a tag `vX.Y.Z` |
| `publish <group or owner> [name]` | publish everything in the workspace |

`metamodel …` is the same list. A package is used from an SPL by its location, `gitlab:group/project` or `github:owner/repo`;
`--remote` shows what is on the host.

### On the server

`reconcile spls|products`, `namespaces`, `product logs`, `product pipeline`, `product changes`, `product deployment`, `product rollback`; they need you signed in and say so when you are not.

## Scripts and CI

- `--json` prints data instead of text (`status`, `check`, `module list`, `doctor`…); `--local` says no server.
- The exit code is `0` when it worked, `1` when it did not or a check found problems, `2` when the command was used wrong.
- Normal output goes to stdout, errors and notes to stderr.

```bash
linea --json check || exit 1
linea module publish --bump patch --to my-group
```

## Worth knowing

- **`push` never touches the default branch** unless you say `--direct`: it makes a branch and a merge/pull request. What does not
  check out is not sent (`--no-check` overrides it).
- **`generate` is local.** It writes into the product's folder and bumps its version; `push` sends it. `generate --remote` is the one
  that runs on LINEA, from what LINEA has: push first. `--preview` and `--zip` refuse to write into a workspace or SPL folder.
- **Deleting is local too.** `spl delete` and `product delete` remove the folder from this machine and say that LINEA still has its copy.
  The feature model of an SPL made of modules is composed from its modules: it is read-only. Change the file of a plain SPL with `open fm`.
- **Not committed by the CLI**: `.linea/origin.json` (where a copy came from), `.linea/composed-model.uvl` (a cache) and the
  `.code-workspace` file are kept out of the repositories through `.git/info/exclude`.

## Product spec file

`product new --from <file>` reads a JSON spec:

```json
{
  "basicData": { "name": "MyProduct", "version": "0.0.0", "languages": ["en"], "SRID": "4326" },
  "dataModel": { "cells": [] },
  "features":  ["Foo", "Bar"],
  "statics":   []
}
```

Names allow `[a-zA-Z0-9_.-]`, versions must be `x.y.z`, and the selection is validated against the SPL's feature model.

## The window

`linea` on its own opens it. It starts with a panel that says where you are (the SPL, product or package of the folder, its branch and
what is waiting to be pushed) and the few commands worth running *there*: outside an SPL it offers `spl list`, `get` and `spl new`; inside
one with changes, `push` comes first; inside a product, `open`, `product show`, `check`. The same suggestions order the menu and the top
of `help`.

Commands are plain text (`get gis-apps`, `spl list`); a leading `/` is optional. Start typing and the menu follows the first word,
with the suggested commands first and what each does *right now*; `/` on its own shows the whole menu.

| | |
|---|---|
| Tab, Enter | complete the highlighted suggestion (Enter runs the line once it is a whole command) |
| ↑ / ↓ | move through the menu; recall earlier commands when there is none |
| `?` | the keyboard shortcuts |
| Esc, Ctrl+U, Ctrl+W | clear the line, clear it, delete the last word |
| Ctrl+L | clear the screen |
| Ctrl+C | quit |

The line under the prompt shows the SPL or product you are in, its branch, `●n` changes, `↑n` to push, `↓n` to get, and which side
commands act on.

## Where the logic lives

The CLI reads what you typed, runs one operation of a library, and says the result in words. It does not decide anything about SPLs,
products or git itself:

| | In | What |
|---|---|---|
| SPLs, products, modules and metamodels as folders: create, check, derive, resolve; versions and feature selection; `findContext` (where a folder stands); `.linea/origin.json` | `linea-core` (`@lbdudc/linea-core/workspace`) | the workspace; it needs a metamodel engine, which this program gives it (bango) in `src/core/workspace.ts` |
| Metamodels and their models | `bango` | through linea-core |
| git: clone, pull, push with a merge request, upload a folder as an SPL, state of a checkout, where checkouts are, getting a package of the host, the credential-helper protocol | `linea-git` (`checkout`) | git itself, and the host's API |
| What is of a terminal program: the grammar and flags, the window, what to suggest, which credential helper git is given (this program), where the token is kept, and the words | `linea-cli` | |

## Development

```bash
bun run dev          # the window from source
bun run typecheck
bun test             # ~220 tests: the commands, real git against bare repositories, the git host in memory
bun run build        # dist/index.js, what `linea` runs
```

The tests that touch git run the real `git`; the LOCAL ones stub `fetch` to throw, so a stray network call fails them.
`@lbdudc/linea-git/testing` serves an in-memory GitLab and GitHub that also speak git over HTTP, which is what the dev stack
(`linea/server/dev`) uses, so `get` and `push` can be tried against it without a real host.
