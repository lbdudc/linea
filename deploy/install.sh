#!/usr/bin/env bash
# One-step install of LINEA with the published Docker images (ghcr.io/lbdudc/linea-server and linea-client).
# Creates deploy/.env with fresh secrets the first time, starts the stack and waits until it answers.
#   ./install.sh                 latest release
#   LINEA_VERSION=0.2.0 ./install.sh
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null || { echo "Docker is required: https://docs.docker.com/get-docker/" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required (docker compose ...)" >&2; exit 1; }

rand() { openssl rand -hex 16 2>/dev/null || LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 32; }
setvar() { # setvar NAME VALUE: replace NAME=... in .env (portable sed)
  local tmp; tmp=$(mktemp)
  awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k{print k "=" v; next} {print}' .env >"$tmp" && mv "$tmp" .env
}

PASSWORD=""
if [ ! -f .env ]; then
  cp .env.example .env
  PASSWORD=$(rand)
  setvar JWT_SIGN_KEY "$(rand)$(rand)"
  setvar LINEA_ADMIN_PASSWORD "$PASSWORD"
  echo "Wrote deploy/.env with new secrets."
fi
[ -n "${LINEA_VERSION:-}" ] && { grep -q '^LINEA_VERSION=' .env && setvar LINEA_VERSION "$LINEA_VERSION" || echo "LINEA_VERSION=$LINEA_VERSION" >>.env; }

docker compose pull
docker compose up -d

PORT=$(grep -E '^PROXY_PORT=' .env | cut -d= -f2); PORT=${PORT:-9000}
printf "Waiting for LINEA on http://localhost:%s " "$PORT"
for _ in $(seq 1 90); do
  if curl -fsS -o /dev/null "http://localhost:$PORT" 2>/dev/null; then
    echo; echo "LINEA is up: http://localhost:$PORT"
    echo "Sign in as: $(grep -E '^ADMIN_USERS=' .env | cut -d= -f2)"
    [ -n "$PASSWORD" ] && echo "Password:   $PASSWORD   (also in deploy/.env as LINEA_ADMIN_PASSWORD)"
    exit 0
  fi
  printf "."; sleep 2
done
echo; echo "Not answering yet. See: docker compose logs -f server" >&2; exit 1
