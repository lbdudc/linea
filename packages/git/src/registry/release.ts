import semver from 'semver'
import { generateChangelog, type Changelog } from '../changelog/index.js'
import { PackageVersionExistsError, PackageVersionInvalidError } from '../errors.js'
import type { GitProvider, Id, Release } from '../provider.js'

/**
 * What publishing a version of a package involves besides the tag: checking that the version may be published, suggesting the bump the
 * commits imply, and the release (with its changelog) that goes with the tag. Shared by `publishPackage` and `publishFolder`, so
 * modules and metamodels, on GitLab and on GitHub, are published the same way.
 */

export type BumpLevel = 'major' | 'minor' | 'patch'


/** Text that goes to a terminal or a log: control characters (ANSI escapes among them) are dropped. */
export const printable = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim()

/** The versions a package has tagged (`vX.Y.Z`, with or without the `v`, prereleases too), highest first. */
export const publishedVersions = (tags: { name: string }[]): string[] =>
  semver.rsort(tags.map((tag) => semver.valid(tag.name.replace(/^v/, ''))).filter((version): version is string => version !== null))

/** The name of the tag of a version, as the repository spells it. */
export const tagOf = (tags: { name: string }[], version: string): string =>
  tags.find((tag) => tag.name === `v${version}` || tag.name === version)?.name ?? `v${version}`

/** Whether `version` is written the way a manifest has to: valid semver, as it is, without a `v` or spaces. */
export const isStrictSemver = (version: unknown): version is string => typeof version === 'string' && semver.valid(version) === version

/**
 * Throws if `version` cannot be published on top of `published` (the versions already tagged): `PackageVersionInvalidError` when it
 * is not semver or not greater than the highest one, `PackageVersionExistsError` when it is one of them.
 */
export const assertPublishable = ({ version, published, file }: { version: unknown, published: string[], file: string }): string => {
  if (!isStrictSemver(version)) {
    throw new PackageVersionInvalidError(`${JSON.stringify(version)} is not a valid semver version (X.Y.Z): fix the version in ${file}`)
  }
  const valid = version
  if (published.some((other) => semver.eq(other, valid))) {
    throw new PackageVersionExistsError(`v${valid} is already published: raise the version in ${file} (or publish with a bump)`)
  }
  const latest = published[0]
  if (latest !== undefined && semver.lt(valid, latest)) {
    throw new PackageVersionInvalidError(`${valid} is lower than v${latest}, the last version published: raise the version in ${file} above it`)
  }
  return valid
}

/** The bump the commits of a changelog imply: a breaking change is major, a feature minor, a fix (or an improvement) patch; none if there is nothing of those. */
export const suggestBump = (commits: Pick<Changelog['commits'][number], 'type' | 'breaking'>[]): BumpLevel | null => {
  if (commits.some((commit) => commit.breaking)) return 'major'
  if (commits.some((commit) => commit.type === 'feat')) return 'minor'
  if (commits.some((commit) => commit.type === 'fix' || commit.type === 'perf')) return 'patch'
  return null
}

/** A warning (never an error) when the version of the manifest is not the bump the commits imply. */
export const bumpWarning = ({ latest, version, suggested }: { latest: string | undefined, version: string, suggested: BumpLevel | null }): string | null => {
  if (latest === undefined || suggested === null) return null
  const actual = semver.diff(latest, version)
  const level: BumpLevel | null = actual === 'major' || actual === 'premajor' ? 'major' : actual === 'minor' || actual === 'preminor' ? 'minor' : actual ? 'patch' : null
  if (level === suggested) return null
  return `${version} is a ${level} bump over ${latest}, but the commits since then imply a ${suggested} one`
}

export interface Preflight {
  version: string
  /** The bump the commits since the last published version imply (null: first publication, or nothing that implies one). */
  suggestedBump: BumpLevel | null
  warnings: string[]
}

/** Validates `version` against the tags of the repository and compares it with what the commits on `ref` imply. Throws if it cannot be published. */
export const preflight = async ({ provider, token, id, version, file, ref = 'main' }: { provider: GitProvider, token: string, id: Id, version: unknown, file: string, ref?: string }): Promise<Preflight> => {
  const tags = await provider.listTags({ token, id })
  const published = publishedVersions(tags)
  const valid = assertPublishable({ version, published, file })
  const latest = published[0]
  const warnings: string[] = []
  let suggestedBump: BumpLevel | null = null
  if (latest !== undefined) {
    const changes = await generateChangelog({ provider, token, id, from: tagOf(tags, latest), to: ref })
    suggestedBump = suggestBump(changes.commits)
    const warning = bumpWarning({ latest, version: valid, suggested: suggestedBump })
    if (warning) warnings.push(warning)
  }
  return { version: valid, suggestedBump, warnings }
}

/** Creates the release of a tag that was just created, with the changelog from the previous published version. Returns it, or the reason it could not be made. */
export const createPackageRelease = async ({ provider, token, id, tag, name }: { provider: GitProvider, token: string, id: Id, tag: string, name: string }): Promise<{ release: Release | null, warning: string | null }> => {
  try {
    const changes = await generateChangelog({ provider, token, id, to: tag, title: `${name} ${tag}` })
    const release = await provider.createRelease({ token, id, tag, name: `${name} ${tag}`, description: changes.markdown })
    return { release, warning: null }
  } catch (error) {
    // the tag is what publishes a version; a release that fails is reported, not a reason to leave the caller without knowing the tag exists
    return { release: null, warning: `${tag} was published but its release could not be created: ${printable((error as Error).message)}` }
  }
}
