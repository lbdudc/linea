# @lbdudc/linea-git

The git host of LINEA, **GitLab or GitHub**, behind one interface. The LINEA server and the LINEA CLI both use it, so what a deployment
can do on one host it can do on the other, and a package can be published from a terminal exactly as the server publishes it.

```
linea-core   offline: SPLs, feature models, modules, metamodels, derivation       (no network, by design)
linea-git    the network: repositories, files, commits, pull/merge requests, the registry of packages
server, CLI  use both
```

## What is in it

| | |
|---|---|
| `GitProvider` | the contract: ~45 methods (namespaces, repositories, files, commits, branches, tags, change requests, pipelines, webhooks, identity) in neutral words and shapes |
| `GitLabProvider`, `GitHubProvider` | the contract on each host. A provider is also a unit of work: `rollback()` undoes what it created |
| `createGitProvider(config)`, `gitConfigFromEnv(env)` | the host a deployment is on, from `GIT_PROVIDER` and the usual settings (the server reads its environment, the CLI its own) |
| `createPackageSource(config, …)`, `GitLabPackageSource`, `GitHubPackageSource` | where linea-core reads modules and metamodels from: `gitlab:group/project`, `github:owner/repo`, mixed in one SPL, limited by `trustedNamespaces` |
| `listPackages`, `createPackage`, `getPackage`, `savePackageFile`, `publishPackage` | the registry of modules and metamodels: repositories with the topic `linea-module` / `linea-metamodel`, versions are `vX.Y.Z` tags |. Publishing (also `publishFolder`, which throws on a version already tagged) validates the version (semver, higher than the last tag), tags it, creates the release with the changelog and warns when the version does not match the commits; `getPackageChangelog` / `listPackageChangelogs` give the changelog per version for the catalog
| `publishFolder` | publishes the `modules/` and `metamodels/` of a folder to a host (GitLab: under a group; GitHub: siblings of an owner) |
| `generateChangelog({ provider, token, id, from?, to })` | release notes from the commits alone (Conventional Commits): `{ markdown, sections, commits, mergeRequests, issues }`. `from` defaults to the previous `vX.Y.Z` tag; `#N` / `!N` are resolved to issues and merge requests; version bumps, merges and LINEA's own generation/sync commits are left out. Caps: with no previous tag only the last page of commits a host gives (100) is read, a range stops at 1000 commits, and GitHub's compare returns at most 250; `truncated` is set when the generator knows it was cut (not for a host that cuts on its own). At most 200 references are resolved |
| `buildAuthorizeUrl` | where to send a browser to log in on the host |
| `@lbdudc/linea-git/testing` | the two hosts **in memory** (`startGitlabDouble`, `startGithubDouble`): REST-compatible, with real git behind them |
| `@lbdudc/linea-git/contract` | `describeGitProviderContract`: what any provider has to do. A new host is done when it passes |

How a line (a GitLab group with a subgroup per product) is represented on GitHub, which has no groups inside groups, is in
[`linea/docs/git-provider.md`](../linea/docs/git-provider.md).

## Use

```ts
import { createGitProvider, publishFolder, listPackages } from '@lbdudc/linea-git'

const provider = createGitProvider({ provider: 'github', github: {} })        // or { provider: 'gitlab', gitlab: { url } }
await publishFolder({ provider, token, dir: './workspace', root: 'my-org' })
const modules = await listPackages({ provider, token, kind: 'module' })
```

## Develop

```bash
npm install && npm test        # the contract on both hosts, the registry, publishing, package sources, configuration
npm run build                  # dist/, which is what the server and the CLI load
```

`gitlab-commando` (the undoable GitLab session) is a dependency. A consumer that spies on it in its own tests (the server does) has to
resolve it to its own copy: `resolve.dedupe: ['gitlab-commando']` in vitest.
