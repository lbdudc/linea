# syntax=docker/dockerfile:1
#
# The build context is the root of this repository (a monorepo: `docker build -f apps/server/Dockerfile .`).
#
# The plugins and the metamodels are other repositories (lbdudc/linea-plugins, lbdudc/linea-metamodels). They come in as named build
# contexts, and without them the image has neither:
#
#   docker buildx build -f apps/server/Dockerfile \
#     --build-context plugins=../linea-plugins --build-context metamodels=../linea-metamodels .
#
FROM scratch AS plugins
FROM scratch AS metamodels

FROM node:22 AS build
WORKDIR /srv
ENV NPM_CONFIG_FETCH_RETRIES=5 NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000

# --- dependencies: only the workspaces the server needs -------------------------------------------------------------------------
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/git/package.json packages/git/
COPY packages/cli/package.json packages/cli/
COPY packages/ci/package.json packages/ci/
COPY packages/sdk/package.json packages/sdk/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY e2e/package.json e2e/
# patch-package runs after the install, with the patches in place: without them the image would ship unpatched dependencies
# (gitlab-commando, whose rollback() undid only half the stack).
COPY apps/server/patches apps/server/patches
RUN npm ci --ignore-scripts -w @lbdudc/linea-server -w @lbdudc/linea-core -w @lbdudc/linea-git \
    && npx patch-package --patch-dir apps/server/patches
# the install scripts were skipped: the one that matters is the native part of bcrypt
RUN npm rebuild bcrypt

# --- the libraries, built (tsc -> dist/) ----------------------------------------------------------------------------------------
COPY packages/core/ packages/core/
COPY packages/git/ packages/git/
RUN npm run build -w @lbdudc/linea-core && npm run build -w @lbdudc/linea-git

# --- the app ----------------------------------------------------------------------------------------------------------------------
COPY apps/server/ apps/server/

FROM node:22
WORKDIR /srv

COPY --from=build /srv /srv

# The plugins: the server reads them from PLUGINS_DIR, and their dependencies are the server's (node finds /srv/node_modules above
# them). What runs as a service of its own (service/), their tests and their client code are not the server's: those folders are
# the plugin layout of docs/linea/plugins.md §2.
COPY --from=plugins / /srv/plugins/
RUN rm -rf /srv/plugins/.git /srv/plugins/*/service /srv/plugins/*/test /srv/plugins/*/client /srv/plugins/*/stdio
ENV PLUGINS_DIR=/srv/plugins

# The metamodels the lines are made of. A LINEA that keeps its repositories itself (`local` git host) publishes them into it when it
# starts (LINEA_REGISTRY=local:registry/index); on GitLab or GitHub they are published once with scripts/publish-registry.mjs.
COPY --from=metamodels /metamodels/ /srv/registry/metamodels/
ENV REGISTRY_DIR=/srv/registry

WORKDIR /srv/apps/server
EXPOSE 3000
CMD ["npm", "start"]
