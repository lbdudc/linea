import fs from 'node:fs'
import path from 'node:path'

/**
 * What git itself refuses on a push, whoever pushes: the default branch cannot be deleted or rewritten (a force-push), and pushing to
 * it needs maintainer access (`LINEA_PUSH_LEVEL`, which the HTTP layer sets from the person's level in the repository). Other branches
 * are the pusher's own business. LINEA's own writes go through `update-ref`, which runs no hooks.
 */
const PRE_RECEIVE = `#!/bin/sh
zero=0000000000000000000000000000000000000000
head=$(git symbolic-ref HEAD 2>/dev/null)
while read old new ref; do
  [ "$ref" = "$head" ] || continue
  if [ "$new" = "$zero" ]; then
    echo "LINEA: the default branch cannot be deleted" >&2
    exit 1
  fi
  if [ "\${LINEA_PUSH_LEVEL:-0}" -lt 40 ]; then
    echo "LINEA: pushing to the default branch needs maintainer access" >&2
    exit 1
  fi
  if [ "$old" != "$zero" ] && ! git merge-base --is-ancestor "$old" "$new" 2>/dev/null; then
    echo "LINEA: the default branch cannot be force-pushed" >&2
    exit 1
  fi
done
exit 0
`

/** The folder of the hooks every repository of `dataDir` uses (`core.hooksPath`); written again when it is not as it should be. */
export const ensureHooks = (dataDir: string): string => {
  const dir = path.join(dataDir, 'hooks')
  const file = path.join(dir, 'pre-receive')
  let current = ''
  try { current = fs.readFileSync(file, 'utf8') } catch { /* not there yet */ }
  if (current !== PRE_RECEIVE) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, PRE_RECEIVE, { mode: 0o755 })
    fs.chmodSync(file, 0o755)
  }
  return dir
}
