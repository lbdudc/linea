# syntax=docker/dockerfile:1
#
# The plugin runner: the one container that holds the Docker socket, so that LINEA's server does not. The build context is the root of
# this repository: `docker build -f deploy/plugin-runner/Dockerfile .`
FROM node:22-slim

# the Docker CLI and the compose plugin, from Docker's own repository (the runner talks to the host's daemon through the mounted socket)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && echo "deb [signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
    && apt-get purge -y curl gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
# no dependencies: Node's own modules, and the one file of the server that knows the `docker compose` commands
COPY deploy/plugin-runner/ deploy/plugin-runner/
COPY apps/server/src/plugins/ServiceRunner.js apps/server/src/plugins/ServiceRunner.js
RUN echo '{"type":"module"}' > package.json

ENV NODE_ENV=production PORT=7070
EXPOSE 7070
# root: it is what may use the Docker socket, and it is the only thing in this container; it listens on the internal network only
CMD ["node", "deploy/plugin-runner/index.js"]
