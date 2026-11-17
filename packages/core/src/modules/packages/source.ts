import fs from 'node:fs'
import path from 'node:path'
import { InvalidArgumentError, ModuleResolutionError } from '../../errors.js'
import { METAMODEL_MANIFEST_PATH, MODULE_MANIFEST_PATH } from './manifests.js'
import type { PackageFiles, PackageSource } from '../types.js'

const SKIPPED_DIRS: ReadonlySet<string> = new Set(['.git', 'node_modules'])

const decoder = new TextDecoder()
const encoder = new TextEncoder()

/** A file of a package as text; `undefined` when it does not exist. */
export const readPackageText = async ({ files, path: filePath }: { files: PackageFiles, path: string }): Promise<string | undefined> => {
  const bytes = await files.read({ path: filePath })
  return bytes === undefined ? undefined : decoder.decode(bytes)
}

const normalizeDir = (dir: string): string => dir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

/** Whether `file` is inside `dir` (`''` is everything). */
const isUnder = (file: string, dir: string): boolean => {
  const prefix = normalizeDir(dir)
  return prefix === '' || file.startsWith(prefix + '/')
}

/** The files of a directory on disk, as `PackageFiles`. `.git` and `node_modules` are not part of a package. */
export const createFsFiles = ({ dir }: { dir: string }): PackageFiles => {
  const root = path.resolve(dir)
  const walk = (current: string, found: string[]): string[] => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(path.join(current, entry.name), found)
      } else if (entry.isFile()) {
        found.push(path.relative(root, path.join(current, entry.name)).split(path.sep).join('/'))
      }
    }
    return found
  }
  return {
    read: ({ path: filePath }) => {
      const absolute = path.resolve(root, filePath)
      // a path that climbs out of the package is no file of it
      if (absolute !== root && !absolute.startsWith(root + path.sep)) return Promise.resolve(undefined)
      try {
        return Promise.resolve(new Uint8Array(fs.readFileSync(absolute)))
      } catch {
        return Promise.resolve(undefined)
      }
    },
    list: ({ dir: sub }) => {
      if (!fs.existsSync(root)) return Promise.resolve([])
      return Promise.resolve(walk(root, []).filter((file) => isUnder(file, sub)).sort())
    }
  }
}

/** location -> version -> path -> content */
export type MemoryPackages = Record<string, Record<string, Record<string, string | Uint8Array>>>

/** A fixed set of packages held in memory: for tests, and for a server that has already fetched what it needs. */
export const createMemoryPackageSource = ({
  packages,
  revisions = {}
}: {
  packages: MemoryPackages
  /** location -> version -> revision */
  revisions?: Record<string, Record<string, string>>
}): PackageSource => ({
  listVersions: ({ location }) => Promise.resolve(Object.keys(packages[location] ?? {})),
  open: ({ location, version }) => {
    const files = packages[location]?.[version]
    if (files === undefined) {
      return Promise.reject(new ModuleResolutionError(`${location} has no version ${version}.`))
    }
    const paths = Object.keys(files).sort()
    const memory: PackageFiles = {
      read: ({ path: filePath }) => {
        const content = files[filePath]
        return Promise.resolve(content === undefined ? undefined : typeof content === 'string' ? encoder.encode(content) : content)
      },
      list: ({ dir }) => Promise.resolve(paths.filter((file) => isUnder(file, dir)))
    }
    return Promise.resolve(memory)
  },
  revision: ({ location, version }) => Promise.resolve(revisions[location]?.[version])
})

const FILE_PREFIX = 'file:'

/**
 * Packages in folders on disk: the location `file:<folder>` is a folder under `root`. A folder is one working copy, so it has exactly one
 * version, the one its manifest (`module.json` or `metamodel.json`) declares. This is what a local workspace (and the CLI) uses.
 */
export const createFsPackageSource = ({ root }: { root: string }): PackageSource => {
  const folderOf = (location: string): string => {
    if (!location.startsWith(FILE_PREFIX) || location.length === FILE_PREFIX.length) {
      throw new InvalidArgumentError(`"${location}" is not a file: location.`)
    }
    const absolute = path.resolve(root, location.slice(FILE_PREFIX.length))
    const base = path.resolve(root)
    if (absolute !== base && !absolute.startsWith(base + path.sep)) {
      throw new InvalidArgumentError(`"${location}" points outside the workspace.`)
    }
    return absolute
  }
  const declaredVersion = (folder: string): string | undefined => {
    for (const manifest of [MODULE_MANIFEST_PATH, METAMODEL_MANIFEST_PATH]) {
      const file = path.join(folder, manifest)
      if (!fs.existsSync(file)) continue
      try {
        const { version } = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown }
        if (typeof version === 'string') return version
      } catch { /* a manifest that does not parse is reported when it is read */ }
    }
    return undefined
  }
  return {
    listVersions: ({ location }) => {
      const version = declaredVersion(folderOf(location))
      return Promise.resolve(version === undefined ? [] : [version])
    },
    open: ({ location, version }) => {
      const folder = folderOf(location)
      if (declaredVersion(folder) !== version) {
        return Promise.reject(new ModuleResolutionError(`${location} has no version ${version}.`))
      }
      return Promise.resolve(createFsFiles({ dir: folder }))
    }
  }
}

/**
 * A source that answers for a few locations itself (a package made up on the spot, to check one on its own)
 * and leaves every other to `base`.
 */
export const withOverlay = ({ base, overlay, locations }: { base: PackageSource, overlay: PackageSource, locations: ReadonlySet<string> }): PackageSource => ({
  listVersions: (args) => (locations.has(args.location) ? overlay.listVersions(args) : base.listVersions(args)),
  open: (args) => (locations.has(args.location) ? overlay.open(args) : base.open(args)),
  revision: (args) => (locations.has(args.location) ? Promise.resolve(undefined) : (base.revision?.(args) ?? Promise.resolve(undefined)))
})
