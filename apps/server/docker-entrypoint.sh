#!/bin/sh
# Starts the server as `node`. Root only for the moment it takes to hand over what an older image (which ran as root) left in a volume.
set -e
if [ "$(id -u)" = 0 ]; then
  for dir in /data/repos; do
    if [ -d "$dir" ] && [ "$(stat -c %U "$dir")" != node ]; then chown -R node:node "$dir"; fi
  done
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
