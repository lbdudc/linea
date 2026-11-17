# The git provider: LINEA on GitLab or on GitHub

LINEA is deployed on **one** git host, GitLab or GitHub (`GIT_PROVIDER=gitlab|github`, `gitlab` by default). Everything LINEA needs from that
host is one interface, `GitProvider`, in the library **`@lbdudc/linea-git`** (`linea-git/`). The library is used by the **server** and by the **CLI**; the
services of the server only talk to it (a test, `gitBoundary.test.js`, fails if one imports `gitlab-commando` again).

```
linea-core   offline: SPLs, modules, metamodels, derivation
linea-git    the network: GitLabProvider / GitHubProvider, the registry of packages, publishing, package sources, the hosts in memory
server       model/git/index.js asks the library for a provider from its environment; the services use it
CLI          clone/pull/push (git, with the user's own token), module list --remote, module publish, spl add gitlab:... | github:...; login gets the token from the server
```

What exists:

- **The contract**: about 45 methods in neutral words (namespace, repository, change request) and neutral shapes (`Repository`, `Member`,
  `RepositoryFile`...), typed in `linea-git/src/provider.ts` and listed in `GIT_PROVIDER_METHODS`.
- **`GitLabProvider`** and **`GitHubProvider`** (with `GitHubClient`: ETag, wait-and-retry on rate limits, errors in LINEA's terms). Configuration is
  passed in (`GitConfig`), never read from the environment inside them; `gitConfigFromEnv` is how the server builds it.
- **The registry** (`listPackages`, `createPackage`, `savePackageFile`, `publishPackage`, `publishFolder`) and the **package sources** linea-core
  reads from: written once, for both hosts, used by the server's `PackageService`, by `scripts/publish-registry.mjs` and by the CLI.
- **Git over HTTP, in memory too**: the two hosts of `@lbdudc/linea-git/testing` also speak git (`git clone`, `pull`, `push` against `<url>/<path>.git`, through
  `git http-backend`). A bare repository per project is kept in step with the in-memory one in both directions, and what a push brings is in the model
  before the push is answered, so the next REST call (open a merge request for the branch just pushed) sees it. The dev stack uses it, so the CLI's
  `clone` and `push` can be tried on a laptop; `linea-git/test/git-http.test.ts` runs real git against both hosts.
- **A contract test** (`@lbdudc/linea-git/contract`): the behaviour every provider has to have, host-neutral. It runs against the in-memory GitLab
  and the in-memory GitHub (`@lbdudc/linea-git/testing`), plus the tests that are GitHub-only (namespaces, name collisions, access of someone who
  can only read, binary files, a branch that moves during a commit, pipeline statuses, rate limits, ETags). **A new provider is done when it passes the
  contract**, because the services only rely on what it checks.
- **Neutral errors** (`GitAuthError`, `GitError`) next to the GitLab ones, with the same HTTP mapping.
- **The same whole-system check on both hosts**: `npm run dev:smoke` (15 steps through the HTTP API: login, the registry, a line made of
  modules, a product, its models, generation with its pull/merge requests) passes on the GitLab stack and on the GitHub one.

## Same idea, other words

| LINEA needs | GitLab | GitHub | gap |
|---|---|---|---|
| a place that holds repositories | group (nestable), subgroup | organisation or user account (flat) | **big** |
| a repository | project (numeric id) | repository (numeric id, stable under rename: `GET /repositories/{id}`) | none |
| topics `spl`, `product`, `linea-module`... | topics | topics (lowercase letters, digits, hyphens) | none |
| read a file, with a "last version" to quote | `last_commit_id` | blob `sha` | small |
| commit several files at once, only if nobody moved | commits API with actions + `last_commit_id` | git data API: blobs, tree, commit, then move the ref (a non-fast-forward move is refused) | medium |
| zip of a ref | `archive.zip?sha=` | `zipball/{ref}` (redirect) | small |
| merge request, merge when mergeable | MR, `detailed_merge_status` | PR, `mergeable` computed lazily (poll), `PUT /pulls/{n}/merge` | medium |
| pipeline status of a ref | pipelines | Actions runs (`status` + `conclusion`) | small |
| access of a user: 10/20/30/40/50 | `members/all` (includes inherited) | `GET /repos/{o}/{r}/collaborators/{user}/permission` (read/triage/write/maintain/admin, includes org and team grants) | small |
| webhook, verified by a secret header | `X-Gitlab-Token` equals the secret | `X-Hub-Signature-256` (HMAC of the body) | small |
| OAuth login, refresh token | OAuth2, tokens last 2 h, refresh | OAuth App: tokens do not expire, no refresh. GitHub App: expiring tokens with refresh | small |
| web IDE link | `/-/ide/project/…` | `https://github.dev/owner/repo` | none |
| delete a line, keeping some products | the group takes everything; to keep a product, repository and group go one by one and it waits the period set on the instance | the namespace is the repository; it goes at once | medium (`capabilities().deletion`, `deleteLineOnHost`) |
| restore what waits to be deleted | `POST projects/:id/restore`, `POST groups/:id/restore`; a group brings back what is in it, what is left out is scheduled again | nothing waits: it refuses with 400 | medium (`restoreRepository`, `restoreNamespace`, `restoreLineOnHost`) |
| CI file of the generated product | `.gitlab-ci.yml` | `.github/workflows/*.yml` | medium (content, not API) |

The contract already absorbs the small ones: `RepositoryFile.revision` is the "quote it later" value on both hosts; `commit` takes
`expectedRevision` and fails with status 409 when the file moved on (the services retry on 400/409 today); `getMembers` returns a numeric
`accessLevel` on the GitLab scale (GitHub: read/triage 20, write 30, maintain 40, admin 50); `ensureWebhook` hides who verifies what;
`getLatestPipeline` returns `success|failed|running|pending|canceled`.

## The problem that is not small: groups inside groups

On GitLab a **line is a group** that holds the line's repository and one **subgroup per product**, each holding the product's repository.
That is how LINEA knows which products belong to a line (the parent of a product's group is the line's group), how it deletes a line with all
its products at once, and how members of the line are inherited by the products.

GitHub has none of that: a repository lives directly in an account, there is no nesting, and creating organisations is not an API operation on
github.com. Candidates:

1. *A repository per line and per product, associated by a topic.* Works on github.com and Enterprise, needs no extra GitHub features. **Chosen.**
2. *One repository per line, products as branches/folders.* Changes what a product is (its own history, MRs, CI): rejected.
3. *One organisation per line.* Not creatable through the API on github.com: rejected.
4. *Association by name* (`line.product`). `NAME_PATTERN` allows every character GitHub allows in a name (`.`, `-`, `_`), so no separator is
   unambiguous: rejected.

### How the chosen shape hides behind the contract

Every LINEA group holds exactly one repository (the line's, or the product's) plus child groups, so a **namespace is its repository**:

- `namespaceId` of a line or product on GitHub = the numeric **id of its repository**. Stable under rename, storable in the same `Number`
  field the database has now.
- `listNamespaces` returns what the user can create in: their account and their organisations (`id` = login). That is what the creation
  form's picker shows, as today.
- `createNamespace({name, parentId})` makes **nothing on GitHub**: it returns a pending namespace (`parentId` is a login when the parent is
  an account, or a repository id when it is a line). `createRepository({namespaceId})` is the call that creates the repository, in the account
  that owns the parent, and gives it the topic **`linea-in-<id of the parent repository>`** when it has a parent.
- `Repository.namespaceId` is then the repository's own id and `parentNamespaceId` the parent's: the services already take both from the
  repository (this is why `ProductService` reads `repo.namespaceId` rather than the id `createNamespace` returned), and the reconcile code that
  links a product to its line (`findByGitlabNamespaceId(parentNamespaceId)`) works unchanged. Topics come back in the repository listings, so
  discovering the link costs no extra request.
- `deleteNamespace(id)` deletes the repository and every repository that has the topic `linea-in-<id>`: deleting a line deletes its products,
  as deleting a group does. `renameNamespace(id, name)` renames the repository; the `renameRepository` that follows it finds the name already set.
- Names: two products of one line cannot have the same name (already a rule). A line and a product in the same account cannot collide
  either because a product repository is named `<line>-<product>`: GitHub names are unique per account, so the name only has to be unique, and
  the association with the line is the topic, never the name. If that name is taken the creation is refused with a message, the same way a
  duplicate name is refused today.
- `rollback()` deletes what was created, newest first, as the GitLab session does.

### Inherited access

On GitLab the members of a line's group are members of its products. On GitHub access is per repository, plus what the organisation and its
teams grant. The provider keeps the same check: `getAccessLevel` answers for the repository itself (GitHub includes the organisation's base
permission and the user's teams in it), and `getMembers` lists the collaborators (a reader who may not list them sees only themselves). Where
the organisation's base permission or a team already gives the line's people access to all its repositories (the common setup), a product
is open to them with nothing copied. What is **not** equivalent: a person added to the line's repository alone is not added to its products. A
"sync access" action (copy the collaborators and team grants of the line to its products) is the missing piece if that is needed; until then
access is managed through an organisation team.

## What else changes on GitHub

- **Login**: a GitHub OAuth App is simplest (no refresh: the stored refresh token stays empty, and `refreshToken` returns the same access
  token); a **GitHub App** gives expiring tokens with refresh and finer permissions and is the better choice for a shared deployment. Scopes
  for an OAuth App: `repo`, `delete_repo`, `read:org`, `write:repo_hook`. The client builds the authorize URL from `authConfig().authorizeUrl`
  (already sent by `/api/users/config`).
- **Rate limits**: 5,000 requests an hour per user token, and "secondary" limits for bursts of writes. LINEA makes several calls per product
  on the product pages and a burst during generation. The provider needs conditional requests (`ETag`), a small per-request cache, writes
  one at a time, and a retry that honours `Retry-After`.
- **Commits**: a multi-file commit is four calls (blobs, tree, commit, ref). `expectedRevision` is checked against the blob sha at the head
  before the commit is created, and the ref update (without `force`) rejects a concurrent move: both give status 409.
- **Pull requests**: `mergeChangeRequest` polls `mergeable` until it is known, merges, and returns `true` when the PR is dirty (conflicts),
  like the GitLab code path. Branch protection that blocks the merge is reported as an error, not as conflicts.
- **The generated product's CI**: the platform scaffold in linea-core ships `.gitlab-ci.yml` (two jobs: `test_server` on `gradle:8-jdk21`,
  `test_client` on `node:20`). On GitHub the same two jobs go in `.github/workflows/ci.yml`. `buildLineScaffold` gets a `ci: 'gitlab'|'github'`
  option, and the provider says which (`provider.kind`). Lines already created keep their file.
- **Webhooks**: LINEA's intake route for GitLab (`/api/webhooks/gitlab`) checks a shared header; for GitHub it checks the HMAC. `webhookPath`
  and `ensureWebhook` are already per provider; the route itself belongs to the process that receives push events.
- **Client**: the labels "GitLab", "merge request", the `GitLabButton` and the `gitlabUrl` config key become the host's own. `/api/users/config`
  already returns `provider` and `authorizeUrl`. Database field names (`gitlabProjectId`...) are kept: they hold the host's ids, and renaming them
  would be a migration with no behaviour behind it.
- **Packages (modules and metamodels)** are already host-neutral: a location is `gitlab:group/project` or `github:owner/repo`, and an SPL can mix
  hosts (see *Packages on GitHub*). On a GitHub deployment the user's own token reads GitHub.

## Packages on GitHub

Modules and metamodels can live in GitHub repositories, next to or instead of GitLab ones. A location says where a package lives:
`gitlab:group/project`, `github:owner/repo`, `file:modules/core`. Relative references work the same way (`../basic` in `github:acme/core`
is `github:acme/basic`), and an SPL can mix hosts: a module on GitHub may require a metamodel on GitLab. On GitHub a package is a
repository with the topic `linea-module` or `linea-metamodel`, and its versions are the tags `vX.Y.Z`; with no groups inside an owner,
a reference like `../../metamodels/x` is written `../x` there (`publishFolder` does it, so a module and a metamodel must not share a name).

The pieces are `GitLabPackageSource` and `GitHubPackageSource` in `linea-git`, one source that routes by scheme (linea-core
`createRoutingSource`, built by `createPackageSource`), and linea-core's registries and resolvers over any source. Configuration (server environment):

- `LINEA_GITHUB_OWNERS=acme,other-org`: the owners whose repositories the **Modules** page lists (found by topic with the search API).
  Without it, GitHub packages can still be used by an SPL if the location is known; they just are not listed.
- `GITHUB_TOKEN`: optional. Without it GitHub allows 60 requests an hour, enough for a few public packages (what a tag holds is
  cached); with it the limit is higher and private repositories are readable. `LINEA_GITHUB_API` points at GitHub Enterprise.
- `LINEA_TRUSTED_NAMESPACES`: metamodels carry scripts that run in the server, so this limits where packages may come from.
  Entries that start with `github:` apply to GitHub (`github:acme`), the others to GitLab. If the variable is set and has no entry for a
  host, nothing is read from that host.

Creating, editing and publishing packages goes through the same provider as on GitLab (the Modules page, `scripts/publish-registry.mjs --host github`,
the CLI's `module publish`).

## Running on GitHub

```bash
# the in-memory GitHub of the dev stack (user dev, organisation acme), with the registry published into it
cd server && node dev/fake-github.js            # port 8082
# the server on it
GIT_PROVIDER=github GITHUB_URL=http://localhost:8082 GITHUB_API_URL=http://localhost:8082 GITHUB_WEB_IDE_URL=http://localhost:8082   GITHUB_CLIENT_ID=dev-client GITHUB_CLIENT_SECRET=dev-secret REDIRECT_URI=http://localhost:9000 port=3000 … node index.js
# or all of it:  GIT_PROVIDER=github npm run dev:up
```

On the real thing: `GIT_PROVIDER=github`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` of the OAuth App (or GitHub App), `REDIRECT_URI` as for
GitLab, and, for GitHub Enterprise Server, `GITHUB_URL` and `GITHUB_API_URL`. The registry of metamodels and modules is published with
`node scripts/publish-registry.mjs --host github --owner <user or organisation>`.

## What is not covered

- **Not run against github.com.** Everything is checked against the in-memory GitHub, which follows the documented API (including its
  quirks: `mergeable` is `null` the first time, ref updates that are not fast-forwards are refused, an update needs the current sha).
  A first run against a real organisation may find a difference; the contract suite is where it would be fixed once.
- **Access inherited from the line.** A product repository gets no copy of the collaborators and teams of its line's repository (on
  GitHub the organisation's base permission and its teams are the way); a "sync access" action is the missing piece if that is not enough.
- **The webhook receiver.** The provider registers the webhook (`ensureWebhook`), verifies a delivery (`verifyWebhook`) and reads a push
  (`parsePushEvent`); the route that receives push events is not in this server.
- **Repositories with more than ~100k files**: GitHub truncates the tree listing; LINEA's repositories are far smaller.
