# Contributing

1. Node 22, `npm install`, `npm run build`, `npm test`. The tests that use the plugins or the metamodels need `lbdudc/linea-plugins` and
   `lbdudc/linea-metamodels` checked out next to this repository (or `PLUGINS_DIR` / `LINEA_METAMODELS_DIR`).
2. Releases are made from GitHub Releases (see the README): there is nothing to add to a change for it to be released.
3. The line between the core and the plugins is enforced by `apps/server/src/test/boundary.test.js` (see `docs/linea/architecture.md`): the core
   never names a plugin, and a plugin imports only the host contract.
4. Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:` ...).

## Releasing (maintainers)

- **Releases**: create a GitHub Release with a tag `vX.Y.Z`. Bump the **patch** (0.3.1, 0.3.2...) unless you mean a bigger change: minor and major bumps are deliberate. The workflows do the rest: npm, the commit list in the notes, and the Docker images.
- **npm**: no token. Each package has a *trusted publisher* on npmjs.com (package → Settings → Trusted Publisher: GitHub Actions, `lbdudc/linea`, workflow `release.yml`). A new package needs one before its first release (publish it once by hand, then add it).
- **Docker**: images go to `ghcr.io/lbdudc/linea-server` and `linea-client`. For Docker Hub too, set the repository variable `DOCKERHUB_ENABLED=true` and the secrets `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.
- By hand, if ever needed: `node scripts/set-version.mjs vX.Y.Z` then `npm run publish:core` (and `git`, `cli`, `ci`, `sdk`).
