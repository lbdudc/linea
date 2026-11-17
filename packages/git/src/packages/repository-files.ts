import type { PackageFiles } from '@lbdudc/linea-core'
import type { GitProvider, Id } from '../provider.js'

/**
 * The files of a repository at `ref` as linea-core's `PackageFiles`, on whatever git host the provider is for. Used for the
 * repository of an SPL (its `spl.json`, lockfile and platform), which is read as it is on `main`.
 */
export const repositoryFiles = ({ provider, token, id, ref }: { provider: GitProvider, token: string, id: Id, ref: string }): PackageFiles => ({
  read: async ({ path }) => {
    const bytes = await provider.readFile({ token, id, path, ref })
    return bytes === null ? undefined : new Uint8Array(bytes)
  },
  list: async ({ dir }) => {
    const paths = await provider.listFiles({ token, id, ref })
    const prefix = dir.replace(/^\/+|\/+$/g, '')
    return prefix === '' ? paths : paths.filter((file) => file.startsWith(`${prefix}/`))
  }
})
