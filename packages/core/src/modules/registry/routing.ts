import { ModuleResolutionError } from '../../errors.js'
import type { PackageSource } from '../types.js'

const SCHEME = /^([a-z][a-z0-9+.-]*):/i

/**
 * One `PackageSource` made of several, one per host: a location says where it lives with its scheme (`gitlab:group/project`,
 * `github:owner/repo`, `file:modules/core`), so a module on GitHub can require a metamodel on GitLab and the SPL does not care.
 */
export const createRoutingSource = ({ sources }: { sources: Readonly<Record<string, PackageSource>> }): PackageSource => {
  const sourceOf = (location: string): PackageSource => {
    const scheme = SCHEME.exec(location)?.[1]?.toLowerCase()
    const source = scheme === undefined ? undefined : sources[scheme]
    if (source === undefined) {
      const known = Object.keys(sources).map((name) => `${name}:`).join(', ')
      throw new ModuleResolutionError(`"${location}" is not a location any registry here reads (${known}).`)
    }
    return source
  }
  return {
    listVersions: (args) => sourceOf(args.location).listVersions(args),
    open: (args) => sourceOf(args.location).open(args),
    revision: (args) => sourceOf(args.location).revision?.(args) ?? Promise.resolve(undefined)
  }
}
