#!/usr/bin/env bash
# Starts the dev backend (MongoDB and the server, plus a dev GitLab or GitHub if asked) in the background; logs go to ./.dev-data/*.log (DEV_DATA=<folder> keeps them, Mongo and the repositories elsewhere).
#
# The repositories are on the server itself by default (the `local` git host: sign in as dev / devdevdev). GIT_PROVIDER=gitlab runs a dev
# GitLab in memory instead, GIT_PROVIDER=github a dev GitHub; both come with the registry published into them. GIT_HOSTS=local,gitlab,github
# runs several together (the first is the primary one; GITLAB_PORT=8091 GITHUB_PORT=8092 move the dev hosts). LINEA_CONFIG=<file> adds a linea.config.yml.
# MONGO_PORT=27018, SERVER_PORT=3100 and CLIENT_PORT=9100 move them when something else holds the usual 27017, 3000 and 9000.
# The client is started separately:  cd ../client && LINEA_SERVER=http://127.0.0.1:3000 npx vite --port 9000 --strictPort
cd "$(dirname "$0")/.."
DATA="${DEV_DATA:-.dev-data}"
mkdir -p "$DATA"
DATA="$(cd "$DATA" && pwd)"
# The repo root, one level up from server/ — where modules/ and metamodels/ live.
export REGISTRY_DIR="${REGISTRY_DIR:-$(pwd)/../../../linea-metamodels}"  # the linea-metamodels checkout next to this one
MONGO_PORT="${MONGO_PORT:-27017}"
SERVER_PORT="${SERVER_PORT:-3000}"
CLIENT_PORT="${CLIENT_PORT:-9000}"
PORT="$MONGO_PORT" DB_PATH="$DATA/mongo" node dev/mongo.js > "$DATA/mongo.log" 2>&1 &
until grep -q ready "$DATA/mongo.log" 2>/dev/null; do sleep 1; done
# `dev` is an administrator (it can switch plugins in the Plugins view and sees the settings); the plugins in LINEA_PLUGINS are on from the first start
PLUGINS="${LINEA_PLUGINS-analytics-plugin}"
# LINEA_DEV_ENV=<file>: variables for this server that a plugin needs (the keys of its service...), e.g. ../../linea-plugins/agents-plugin/dev.env
if [ -n "$LINEA_DEV_ENV" ]; then set -a; . "$LINEA_DEV_ENV"; set +a; fi
# apps/server/.env may configure a real GitLab: a dev stack uses none unless it is asked for (an empty value wins over the file)
NO_HOSTS="GITLAB_HOSTNAME= GITLAB_CLIENT_ID= GITLAB_SECRET_ID= GITHUB_URL= GITHUB_API_URL= GITHUB_CLIENT_ID= GITHUB_CLIENT_SECRET="
COMMON="$NO_HOSTS ADMIN_USERS=dev LINEA_ADMIN_PASSWORD=devdevdev LINEA_PLUGINS=$PLUGINS port=$SERVER_PORT mongoUrl=mongodb://127.0.0.1:$MONGO_PORT/splalm?replicaSet=rs0 REDIRECT_URI=http://localhost:$CLIENT_PORT JWT_SIGN_KEY=dev-sign-key LINEA_LOCAL_EXPORT_DIR=$DATA/lines LINEA_LOCAL_PRODUCTS_DIR=$DATA/products"
# GIT_HOSTS=local,gitlab,github runs those hosts together (the first is the primary one); GIT_PROVIDER=<host> is the same with one
GIT_HOSTS="${GIT_HOSTS:-${GIT_PROVIDER:-local}}"
GITLAB_PORT="${GITLAB_PORT:-8081}"
GITHUB_PORT="${GITHUB_PORT:-8082}"
PRIMARY="${GIT_HOSTS%%,*}"
HOSTS_ENV="GIT_PROVIDER=$PRIMARY"
HOST="the git hosts: $GIT_HOSTS"
REGISTRY=""
METAMODEL=""
has() { case ",$GIT_HOSTS," in *",$1,"*) return 0;; esac; return 1; }
if has gitlab; then
  PORT=$GITLAB_PORT node dev/fake-gitlab.js > "$DATA/gitlab.log" 2>&1 &
  until grep -q "registry published\|failed" "$DATA/gitlab.log" 2>/dev/null; do sleep 1; done
  HOSTS_ENV="$HOSTS_ENV GITLAB_HOSTNAME=http://localhost:$GITLAB_PORT GITLAB_CLIENT_ID=dev-client GITLAB_SECRET_ID=dev-secret"
  REGISTRY="${REGISTRY:+$REGISTRY,}gitlab:registry/index"
  METAMODEL="${METAMODEL:+$METAMODEL,}gitlab:registry/metamodels/featuremodel"
fi
if has github; then
  PORT=$GITHUB_PORT node dev/fake-github.js > "$DATA/github.log" 2>&1 &
  until grep -q "registry published\|failed" "$DATA/github.log" 2>/dev/null; do sleep 1; done
  HOSTS_ENV="$HOSTS_ENV GITHUB_URL=http://localhost:$GITHUB_PORT GITHUB_API_URL=http://localhost:$GITHUB_PORT GITHUB_WEB_IDE_URL=http://localhost:$GITHUB_PORT GITHUB_CLIENT_ID=dev-client GITHUB_CLIENT_SECRET=dev-secret"
  REGISTRY="${REGISTRY:+$REGISTRY,}github:dev/linea-registry"
  METAMODEL="${METAMODEL:+$METAMODEL,}github:dev/featuremodel"
fi
if has local; then
  # the server publishes the registry into its own repositories when it starts
  HOSTS_ENV="$HOSTS_ENV LINEA_REPOS_DIR=$DATA/repos"
  REGISTRY="${REGISTRY:+$REGISTRY,}local:registry/index"
  METAMODEL="${METAMODEL:+$METAMODEL,}local:registry/metamodels/featuremodel"
fi
env $COMMON $HOSTS_ENV LINEA_REGISTRY=$REGISTRY LINEA_FEATURE_METAMODEL=$METAMODEL node index.js > "$DATA/server.log" 2>&1 &
until curl -s -m 2 http://127.0.0.1:$SERVER_PORT/api/users/config > /dev/null; do sleep 1; done
echo "dev backend up: server http://127.0.0.1:$SERVER_PORT, $HOST, Mongo 127.0.0.1:$MONGO_PORT"
wait
