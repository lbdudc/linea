# Contributing

1. Node 22, `npm install`, `npm run build`, `npm test`. The tests that use the plugins or the metamodels need `lbdudc/linea-plugins` and
   `lbdudc/linea-metamodels` checked out next to this repository (or `PLUGINS_DIR` / `LINEA_METAMODELS_DIR`).
2. A change to a published package (`packages/*`) needs a changeset: `npm run changeset`, then pick the packages and the kind of bump.
3. The line between the core and the plugins is enforced by `apps/server/src/test/boundary.test.js` (see `docs/linea/architecture.md`): the core
   never names a plugin, and a plugin imports only the host contract.
4. Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:` ...).

## Releasing (maintainers)

- **npm**: the *Release* workflow needs the `NPM_TOKEN` secret (an automation token of a maintainer of the `@lbdudc` scope).
  By hand: `npm run publish:core`, `publish:git`, `publish:cli`, `publish:ci`, `publish:sdk` (each builds what it needs first).
- **Docker**: push a tag `vX.Y.Z`. Images go to `ghcr.io/lbdudc/linea-server` and `linea-client`. For Docker Hub too, set the repository variable
  `DOCKERHUB_ENABLED=true` and the secrets `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.
