# Running LINEA on a laptop

In short: `npm run dev:up` (here, in `server/`) starts MongoDB and the server, with the repositories on the server itself (`local` git host; sign in as `dev` / `devdevdev`) and the registry published into them; then start the client (below). `GIT_PROVIDER=gitlab npm run dev:up` (or `github`) works on a dev GitLab (GitHub) in memory instead, and `MONGO_PORT=27018` moves Mongo when something else holds 27017. `GIT_HOSTS=local,gitlab,github npm run dev:up` runs several hosts together (the first is the primary one; `GITLAB_PORT`/`GITHUB_PORT` move the dev hosts, `LINEA_CONFIG=<file>` adds a `linea.config.yml`). The pieces, one at a time:

Everything the server needs, without Docker and without a GitLab account. Four terminals, from `linea/`:

```bash
# 1. MongoDB: a single-node replica set (LINEA uses transactions), kept in server/.dev-data/
cd server && npm run dev:mongo

# 2. A GitLab: the in-memory double the tests use, plus OAuth. When it starts it publishes the registry (the folders
#    LINEA/metamodels and LINEA/modules) into itself with scripts/publish-registry.mjs, the same script you use on a real GitLab.
#    "Sign in with GitLab" lands straight back in LINEA as the user `dev`. Restarting it starts over.
cd server && npm run dev:gitlab

# 3. The server, pointed at both
cd server && port=3000 mongoUrl='mongodb://127.0.0.1:27017/splalm?replicaSet=rs0' \
  GITLAB_HOSTNAME=http://localhost:8081 GITLAB_CLIENT_ID=dev-client GITLAB_SECRET_ID=dev-secret \
  REDIRECT_URI=http://localhost:9000 JWT_SIGN_KEY=dev-sign-key node index.js

# 4. The client (OAuth sends the browser back to REDIRECT_URI, so it has to be on 9000)
cd client && npx vite --port 9000 --strictPort
```

Open <http://localhost:9000>. The dev user is an administrator (`ADMIN_USERS=dev`) and `npm run dev:up` starts with the modules and analytics plugins on (`LINEA_PLUGINS`); the others are one click away in **Plugins** (see `plugins/README.md`). The analysis service of the analytics plugin (and the agents application) is `cd plugins && docker compose --env-file <env> up -d --build` (see `plugins/compose.yml`). The environment variables on the command line win over `server/.env`, so your real settings are not touched.
The dev GitLab and Mongo go together: if you restart the GitLab, also clear `server/.dev-data` (and restart Mongo), or LINEA will
remember lines whose repositories are gone.

## What to try

The registry (**Modules** in the menu) has the metamodels `common`, `basic`, `datamodel`, `featuremodel`, `gismodel`, `forms`, `lists`,
`menus`, `security`, `sensors`, `browser`, `gui` and `statics`, and the modules `main-component`, `user-management-component` (offers the
entities `UMUser` and `Authority`), `data-browser-component`, `data-management-component`, `graphical-user-interface-component`,
`map-viewer-component`, `mobile-workflow-management-component` and `sensor-viewer-component`.

1. **Create an SPL** → check *Built from modules*.
2. Choose `user-management-component`: it needs `main-component`, which is reported with a button to add it. Everything else they need
   (the metamodels) comes with them. The SPL is checked at each change, and the lockfile is committed when it is created.
3. In the SPL, **Modules**: add `data-browser-component`, which asks for `data-management-component`. **Save** shows the version it
   becomes and what it changes for the products. The feature model is composed from the modules.
4. **Create a product**. It starts with a model of every metamodel (`basic`, `datamodel`, `browser`, the feature selection).
5. In the product, the **Config. Modelos** tab: pick `datamodel` and use bango's views (text, form, diagram…). Add
   `relation customer -> UMUser`: it points at what the module offers (read-only); `-> Nobody` is reported. **Guardar** saves.
6. **Generate**. The product repository gets the files of the modules, with your models in them. (The templates of the registry's
   modules do not render entities of the data model yet: generate from the starting models.)
7. In **Modules**, create your own metamodel or module. On its page, the **Declaration** form says which metamodels (and modules) it
   needs and which models it offers; edit its files, **Check** it, **Publish** it, and use it from an SPL.

To put the registry in a real GitLab:

```bash
GITLAB_URL=https://gitlab.example.com GITLAB_TOKEN=<token with api scope>   npm run registry:publish -- --group <path of an existing group>
```

## Demo data

With the stack running, `node dev/seed.mjs` fills it with modular lines, products and generations through the API (`PRODUCTS=`, `ROUNDS=`),
`node dev/seed-line-versions.mjs` gives the lines a history of versions (`STEPS=`), and `node dev/seed-history.mjs` writes a 90-day deployment
history straight into Mongo (`--clean` removes it). All of them are additive; read the header of each for its variables.

## Smoke test

With the four processes running, `npm run dev:smoke` (in `server/`) walks the whole thing through the HTTP API.

## Using your real GitLab instead

Skip steps 2 and the variable overrides, and use the values in `server/.env`. Metamodels carry scripts that run inside the server
and are **not sandboxed**: set `LINEA_TRUSTED_NAMESPACES=group/subgroup,other` to only load packages from GitLab paths you trust.
Give a GitLab project the topic `linea-module` or `linea-metamodel` and tag versions `vX.Y.Z` to publish it by hand.

## Git host

The server works on one git host: `GIT_PROVIDER=gitlab` (the default) or `GIT_PROVIDER=github`. Everything above runs on either.
For GitHub, `node dev/fake-github.js` (port 8082, user `dev`, organisation `acme`) replaces `dev:gitlab`, and the server gets
`GIT_PROVIDER=github GITHUB_URL=http://localhost:8082 GITHUB_API_URL=http://localhost:8082 GITHUB_WEB_IDE_URL=http://localhost:8082
GITHUB_CLIENT_ID=dev-client GITHUB_CLIENT_SECRET=dev-secret` instead of the `GITLAB_*` variables; `GIT_PROVIDER=github npm run dev:up` does all of it.
See `docs/git-provider.md`.

The registry of metamodels and modules is published into whichever host runs with `scripts/publish-registry.mjs`, which is a command line over `publishFolder` of
`@lbdudc/linea-git` (the CLI's `/publish` is another). The two in-memory hosts the dev stack serves are that library's own (`@lbdudc/linea-git/testing`).

### The terminal against the dev stack

The in-memory hosts also serve git (`<host>/<path>.git`), so the CLI can be tried against them without a real GitLab or GitHub.
PowerShell (needs Bun and git):

```powershell
# once: build the CLI and make `linea` a command (it runs the bundle with Bun, from any folder)
cd C:\Users\47852\Desktop\dev\LINEA\linea-cli
bun run build
Add-Content $PROFILE 'function linea { bun --no-env-file C:\Users\47852\Desktop\dev\LINEA\linea-cli\dist\index.js @args }'
. $PROFILE

# every terminal: say which stack (3000 = GitLab stack, 3001 = GitHub stack)
$env:LINEA_BASE_URL = "http://127.0.0.1:3000"

linea login                       # opens the (fake) host's page; the dev host approves it by itself
linea spl list                    # the SPLs of this machine and of LINEA, side by side
linea get Gis-<id>                # the SPL and its products, as git clones, over HTTP (it prints the folder)
cd <the folder it printed>
linea status
linea check
linea open                        # VS Code, with the SPL and the modules it uses
# edit a file, then:
linea push -m "Try it"            # a branch and a merge/pull request on the dev host
linea open --web                  # the same SPL in the web interface
linea open --repo                 # its page on the dev host

# new things go where you are working: made on LINEA, and here in one step
linea spl new demo --plain        # signed in: created on LINEA and cloned into the workspace
cd <workspace>\demo
linea product new first           # created on LINEA, and it appears inside demo\
linea spl new sketch --local      # only here; `linea push` in it uploads it to LINEA later
```

The ids of the seeded SPLs are printed by `node dev/smoke.mjs` (`Gis-…`), and listed by `linea spl list`.

Without a browser (a script, CI), get a session and give it as `LINEA_TOKEN`; `whoami` keeps the git access the server hands out, and `get`, `push` and `check` work from then on:

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/api/users/login/gitlab -ContentType application/json -Body '{"code":"dev-code"}'
$env:LINEA_TOKEN = $login.token
linea whoami
Remove-Item Env:LINEA_TOKEN       # from here on the stored session is used
```
