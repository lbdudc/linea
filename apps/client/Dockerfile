# syntax=docker/dockerfile:1
#
# The build context is the root of this repository (`docker build -f apps/client/Dockerfile .`).
#
# The client is built together with the client code of the plugins (lbdudc/linea-plugins), which only run for what the server says
# is enabled. They come in as a named build context; without it the image has no plugins:
#
#   docker buildx build -f apps/client/Dockerfile --build-context plugins=../linea-plugins .
#
FROM scratch AS plugins

FROM node:22 AS build
WORKDIR /srv
ENV NPM_CONFIG_FETCH_RETRIES=5 NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000

ARG API_URL
ENV API_URL=${API_URL}

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/git/package.json packages/git/
COPY packages/cli/package.json packages/cli/
COPY packages/ci/package.json packages/ci/
COPY packages/sdk/package.json packages/sdk/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY e2e/package.json e2e/
COPY apps/client/scripts apps/client/scripts
# the install hooks are skipped (the root's patches are the server's) and the client's own are run by hand
RUN npm ci --ignore-scripts -w @lbdudc/linea-client \
    && cd apps/client && node scripts/copy-monaco-workers.js && node scripts/copy-bango-worker.js

COPY apps/client/ apps/client/
COPY --from=plugins / /plugins/
ENV PLUGINS_DIR=/plugins

WORKDIR /srv/apps/client
RUN npm run build


# The runtime carries the built files and a static server, not the sources, the dev dependencies and the build tools.
FROM node:22-slim
WORKDIR /srv
RUN npm install -g serve@14 && npm cache clean --force
COPY --from=build /srv/apps/client/dist /srv/dist
USER node
EXPOSE 4000
CMD ["serve", "-s", "dist", "--listen", "4000"]
