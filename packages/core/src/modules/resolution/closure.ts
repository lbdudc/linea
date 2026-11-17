import semver from 'semver'
import { ModuleResolutionError } from '../../errors.js'
import type { LoadedPackage, PackageRegistry } from '../registry/registry.js'
import type { Lock } from '../types.js'

/** A range somebody asks of a package, and who asks. */
export interface Wanted {
  readonly range: string
  readonly by: string
}

export interface Closure<Manifest> {
  /** Every package needed, each at the one version chosen for it. */
  readonly packages: ReadonlyMap<string, LoadedPackage<Manifest>>
  /** Who asked for each, with which range. */
  readonly wanted: ReadonlyMap<string, readonly Wanted[]>
  /** Locations, dependencies before dependants. */
  readonly order: readonly string[]
}

const MAX_ROUNDS = 100

const describeWanted = (wanted: readonly Wanted[]): string =>
  wanted.map(({ range, by }) => `${range} (required by ${by})`).join(', ')

/**
 * The version to use: the locked one while it still satisfies every range (so resolving twice gives the same answer), else the highest
 * published version that does.
 */
const pickVersion = ({
  location,
  available,
  wanted,
  locked
}: {
  location: string
  available: readonly string[]
  wanted: readonly Wanted[]
  locked: string | undefined
}): string => {
  const valid = available.filter((version) => semver.valid(version) !== null)
  const fits = valid.filter((version) => wanted.every(({ range }) => semver.satisfies(version, range)))
  if (locked !== undefined && fits.includes(locked)) return locked
  const best = semver.rsort([...fits])[0]
  if (best !== undefined) return best
  const have = valid.length === 0 ? 'it has no published versions' : `available: ${semver.sort([...valid]).join(', ')}`
  throw new ModuleResolutionError(`No version of ${location} satisfies ${describeWanted(wanted)}; ${have}.`)
}

const sameMap = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean =>
  a.size === b.size && [...a].every(([key, value]) => b.get(key) === value)

/**
 * The packages of ONE registry needed to satisfy `roots`, each at exactly one version: the highest that satisfies the ranges of everyone
 * who asks for it. What a package requires of its own kind is given by `requires` (absolute locations). `lock` is kept wherever it still fits.
 *
 * Each round walks the graph with the versions chosen so far, collects every range asked of every package, and chooses again. It is done
 * when a round chooses what the last one did: the choices are consistent with the dependencies they bring in.
 */
export const resolveClosure = async <Manifest>({
  roots,
  registry,
  requires,
  lock
}: {
  roots: Readonly<Record<string, readonly Wanted[]>>
  registry: PackageRegistry<Manifest>
  requires: (pkg: LoadedPackage<Manifest>) => Record<string, string>
  lock?: Lock
}): Promise<Closure<Manifest>> => {
  const available = new Map<string, string[]>()
  const loaded = new Map<string, LoadedPackage<Manifest>>()

  const versionsOf = async (location: string): Promise<string[]> => {
    const known = available.get(location)
    if (known !== undefined) return known
    const versions = await registry.versions({ location })
    available.set(location, versions)
    return versions
  }

  const load = async (location: string, version: string): Promise<LoadedPackage<Manifest>> => {
    const key = `${location}@${version}`
    const cached = loaded.get(key)
    if (cached !== undefined) return cached
    const pkg = await registry.load({ location, version })
    loaded.set(key, pkg)
    return pkg
  }

  let chosen = new Map<string, string>()
  let wantedNow = new Map<string, Wanted[]>()
  for (let round = 0; ; round++) {
    if (round >= MAX_ROUNDS) throw new ModuleResolutionError('The versions of the modules do not settle: their requirements contradict each other.')
    const wanted = new Map<string, Wanted[]>()
    const visited = new Set<string>()
    const ask = async (location: string, range: string, by: string): Promise<void> => {
      wanted.set(location, [...(wanted.get(location) ?? []), { range, by }])
      if (visited.has(location)) return
      visited.add(location)
      const version = chosen.get(location)
      if (version === undefined) return // its own requirements are found in the next round
      const pkg = await load(location, version)
      const who = `${location}@${version}`
      for (const [other, otherRange] of Object.entries(requires(pkg))) await ask(other, otherRange, who)
    }
    for (const [location, asked] of Object.entries(roots)) {
      for (const { range, by } of asked) await ask(location, range, by)
    }

    const next = new Map<string, string>()
    for (const [location, asked] of wanted) {
      next.set(location, pickVersion({ location, available: await versionsOf(location), wanted: asked, locked: lock?.packages[location]?.version }))
    }
    wantedNow = wanted
    if (sameMap(next, chosen)) break
    chosen = next
  }

  // everything that is chosen has been loaded by the last (consistent) round
  const packages = new Map<string, LoadedPackage<Manifest>>()
  for (const [location, version] of chosen) packages.set(location, await load(location, version))

  // dependencies before dependants; a package that is reached again while it is being visited is a cycle
  const order: string[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (location: string, trail: readonly string[]): void => {
    const status = state.get(location)
    if (status === 'done') return
    if (status === 'visiting') {
      throw new ModuleResolutionError(`Circular requirement: ${[...trail.slice(trail.indexOf(location)), location].join(' -> ')}`)
    }
    state.set(location, 'visiting')
    for (const dependency of Object.keys(requires(packages.get(location)!)).sort()) visit(dependency, [...trail, location])
    state.set(location, 'done')
    order.push(location)
  }
  for (const location of Object.keys(roots).sort()) visit(location, [])

  return { packages, wanted: wantedNow, order }
}
