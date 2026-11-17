import semver from 'semver'
import { NAME_PATTERN, VERSION_PATTERN } from '../../constants.js'
import { ModuleManifestError } from '../../errors.js'
import { isPlainObject } from '../../internal/guards.js'
import type {
  Lock,
  LockEntry,
  MetamodelManifest,
  ModuleManifest,
  PackageKind,
  RegistryEntry,
  RegistryIndex,
  SplKind,
  SplManifest
} from '../types.js'

export const METAMODEL_MANIFEST_PATH = 'metamodel.json'
export const MODULE_MANIFEST_PATH = '.linea/module.json'
export const SPL_MANIFEST_PATH = 'spl.json'
export const LOCK_PATH = 'linea.lock.json'
export const REGISTRY_INDEX_PATH = 'registry.json'

const LOCATION_PATTERN = /^[^\s]+$/

const parseJson = (content: string, label: string): Record<string, unknown> => {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch (error) {
    throw new ModuleManifestError(`${label} is not valid JSON: ${(error as Error).message}`, { cause: error })
  }
  if (!isPlainObject(value)) throw new ModuleManifestError(`${label} must be a JSON object.`)
  return value
}

const fail = (label: string, problems: string[]): never => {
  throw new ModuleManifestError(`${label} is not valid:\n- ${problems.join('\n- ')}`)
}

const readName = (raw: Record<string, unknown>, problems: string[]): string => {
  const { name } = raw
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    problems.push('"name" must be a string of letters, digits, "_", "-" or "."')
    return ''
  }
  return name
}

const readVersion = (raw: Record<string, unknown>, problems: string[]): string => {
  const { version } = raw
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    problems.push('"version" must look like 1.2.3')
    return ''
  }
  return version
}

const readDescription = (raw: Record<string, unknown>, problems: string[]): string | undefined => {
  const { description } = raw
  if (description === undefined) return undefined
  if (typeof description !== 'string') {
    problems.push('"description" must be a string')
    return undefined
  }
  return description
}

/** `{ location: range }`, validated. `where` names it in the messages. */
const readRanges = (value: unknown, where: string, problems: string[]): Record<string, string> => {
  if (value === undefined) return {}
  if (!isPlainObject(value)) {
    problems.push(`${where} must be an object of location -> version range`)
    return {}
  }
  const ranges: Record<string, string> = {}
  for (const [location, range] of Object.entries(value)) {
    if (!LOCATION_PATTERN.test(location)) problems.push(`${where}: "${location}" is not a valid location`)
    else if (typeof range !== 'string' || semver.validRange(range) === null) {
      problems.push(`${where}: the range of "${location}" must be a semver range such as "^1.0.0"`)
    } else ranges[location] = range
  }
  return ranges
}

const isSafeRelativePath = (value: string): boolean =>
  value !== '' && !value.startsWith('/') && !value.includes('\\') && !value.split('/').some((part) => part === '..' || part === '')

const readOffers = (value: unknown, problems: string[]): Record<string, string> => {
  if (value === undefined) return {}
  if (!isPlainObject(value)) {
    problems.push('"offers" must be an object of metamodel -> path')
    return {}
  }
  const offers: Record<string, string> = {}
  for (const [metamodel, path] of Object.entries(value)) {
    if (!NAME_PATTERN.test(metamodel)) problems.push(`"offers": "${metamodel}" is not a valid metamodel name`)
    else if (typeof path !== 'string' || !isSafeRelativePath(path)) {
      problems.push(`"offers": the path of "${metamodel}" must be a relative path inside the module`)
    } else offers[metamodel] = path
  }
  return offers
}

export const parseMetamodelManifest = ({ content }: { content: string }): MetamodelManifest => {
  const label = METAMODEL_MANIFEST_PATH
  const raw = parseJson(content, label)
  const problems: string[] = []
  const name = readName(raw, problems)
  const version = readVersion(raw, problems)
  const description = readDescription(raw, problems)
  const requires = readRanges(raw.requires, '"requires"', problems)
  if (problems.length > 0) return fail(label, problems)
  return { name, version, ...(description === undefined ? {} : { description }), requires }
}

export const parseModuleManifest = ({ content }: { content: string }): ModuleManifest => {
  const label = MODULE_MANIFEST_PATH
  const raw = parseJson(content, label)
  const problems: string[] = []
  const name = readName(raw, problems)
  const version = readVersion(raw, problems)
  const description = readDescription(raw, problems)
  const requiresRaw = raw.requires
  let modules: Record<string, string> = {}
  let metamodels: Record<string, string> = {}
  if (requiresRaw !== undefined) {
    if (!isPlainObject(requiresRaw)) problems.push('"requires" must be an object with "modules" and "metamodels"')
    else {
      modules = readRanges(requiresRaw.modules, '"requires.modules"', problems)
      metamodels = readRanges(requiresRaw.metamodels, '"requires.metamodels"', problems)
    }
  }
  const offers = readOffers(raw.offers, problems)
  if (problems.length > 0) return fail(label, problems)
  return { name, version, ...(description === undefined ? {} : { description }), requires: { modules, metamodels }, offers }
}

const SPL_KINDS: readonly SplKind[] = ['plain', 'project', 'modular']

export const parseSplManifest = ({ content }: { content: string }): SplManifest => {
  const label = SPL_MANIFEST_PATH
  const raw = parseJson(content, label)
  const problems: string[] = []
  const name = readName(raw, problems)
  let version: string | undefined
  if (raw.version !== undefined) version = readVersion(raw, problems)
  const modules = readRanges(raw.modules, '"modules"', problems)
  const metamodels = readRanges(raw.metamodels, '"metamodels"', problems)
  // a manifest that does not say what it is, is what its modules say
  let kind: SplKind = Object.keys(modules).length > 0 ? 'modular' : 'plain'
  if (raw.kind !== undefined) {
    if (!SPL_KINDS.includes(raw.kind as SplKind)) problems.push(`"kind" must be one of ${SPL_KINDS.join(', ')}`)
    else kind = raw.kind as SplKind
  }
  if (kind !== 'modular' && Object.keys(modules).length > 0) problems.push(`"modules" must be empty in a ${kind} SPL: only a modular one is made of modules`)
  if (problems.length > 0) return fail(label, problems)
  return { name, ...(version === undefined ? {} : { version }), kind, metamodels, modules }
}

const sortedEntries = <T>(record: Readonly<Record<string, T>>): [string, T][] =>
  Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

const sortedObject = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
  Object.fromEntries(sortedEntries(record))

export const serializeSplManifest = ({ spl }: { spl: SplManifest }): string =>
  JSON.stringify({
    name: spl.name,
    ...(spl.version === undefined ? {} : { version: spl.version }),
    kind: spl.kind,
    metamodels: sortedObject(spl.metamodels),
    modules: sortedObject(spl.modules)
  }, null, 2) + '\n'

const isKind = (value: unknown): value is PackageKind => value === 'module' || value === 'metamodel'

export const parseLock = ({ content }: { content: string }): Lock => {
  const label = LOCK_PATH
  const raw = parseJson(content, label)
  const problems: string[] = []
  if (raw.lockVersion !== 1) problems.push('"lockVersion" must be 1')
  const packages: Record<string, LockEntry> = {}
  if (!isPlainObject(raw.packages)) problems.push('"packages" must be an object')
  else {
    for (const [location, entry] of Object.entries(raw.packages)) {
      if (!isPlainObject(entry) || !isKind(entry.kind) || typeof entry.version !== 'string' || !VERSION_PATTERN.test(entry.version)) {
        problems.push(`"packages.${location}" needs a "kind" (module or metamodel) and a "version" like 1.2.3`)
      } else if (entry.revision !== undefined && typeof entry.revision !== 'string') {
        problems.push(`"packages.${location}": "revision" must be a string`)
      } else {
        packages[location] = {
          kind: entry.kind,
          version: entry.version,
          ...(entry.revision === undefined ? {} : { revision: entry.revision })
        }
      }
    }
  }
  if (problems.length > 0) return fail(label, problems)
  return { lockVersion: 1, packages }
}

/** Sorted, so two resolutions of the same closure give the same bytes (and the same git diff). */
export const serializeLock = ({ lock }: { lock: Lock }): string =>
  JSON.stringify({ lockVersion: 1, packages: sortedObject(lock.packages) }, null, 2) + '\n'

export const emptyRegistryIndex = (): RegistryIndex => ({ registryVersion: 1, packages: {} })

export const parseRegistryIndex = ({ content }: { content: string }): RegistryIndex => {
  const label = REGISTRY_INDEX_PATH
  const raw = parseJson(content, label)
  const problems: string[] = []
  if (raw.registryVersion !== 1) problems.push('"registryVersion" must be 1')
  const packages: Record<string, Omit<RegistryEntry, 'location'>> = {}
  if (!isPlainObject(raw.packages)) problems.push('"packages" must be an object')
  else {
    for (const [location, entry] of Object.entries(raw.packages)) {
      if (!LOCATION_PATTERN.test(location)) problems.push(`"packages": "${location}" is not a valid location`)
      else if (!isPlainObject(entry) || !isKind(entry.kind) || typeof entry.name !== 'string' || !NAME_PATTERN.test(entry.name) || typeof entry.addedAt !== 'string') {
        problems.push(`"packages.${location}" needs a "kind" (module or metamodel), a valid "name" and an "addedAt" date`)
      } else if ((entry.description !== undefined && typeof entry.description !== 'string') || (entry.addedBy !== undefined && typeof entry.addedBy !== 'string')) {
        problems.push(`"packages.${location}": "description" and "addedBy" must be strings`)
      } else {
        packages[location] = {
          kind: entry.kind,
          name: entry.name,
          ...(entry.description === undefined ? {} : { description: entry.description }),
          addedAt: entry.addedAt,
          ...(entry.addedBy === undefined ? {} : { addedBy: entry.addedBy })
        }
      }
    }
  }
  if (problems.length > 0) return fail(label, problems)
  return { registryVersion: 1, packages }
}

/** Sorted by location, so the same catalog always gives the same bytes (and a small git diff). */
export const serializeRegistryIndex = ({ index }: { index: RegistryIndex }): string =>
  JSON.stringify({ registryVersion: 1, packages: sortedObject(index.packages) }, null, 2) + '\n'
