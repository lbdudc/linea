import fs from 'node:fs'
import { forgetPackageTags } from '../packages/gitlab-source.js'
import path from 'node:path'
import type { PackageCatalog } from '@lbdudc/linea-core'
import type { GitProvider, Id, Namespace } from '../provider.js'
import { PackageVersionExistsError } from '../errors.js'
import { entryFor } from './catalog.js'
import { KIND_DEFINITIONS, type PackageKind } from './kinds.js'
import { assertPublishable, createPackageRelease, preflight, printable, publishedVersions, type BumpLevel } from './release.js'

/**
 * Publishes the metamodels and modules of a folder to the git host, one repository each, so that LINEA reads them from there.
 *
 * `<dir>` holds `metamodels/<name>/` and `modules/<name>/`. They end up as
 *   GitLab  <group>/metamodels/<name>   topic linea-metamodel      <group>/modules/<name>   topic linea-module
 *   GitHub  <owner>/<name>              topic linea-metamodel      <owner>/<name>           topic linea-module
 * with every file of the folder on `main` and the tag `v<version>` of its manifest. On GitLab the two subgroups are created when
 * missing. GitHub has no groups inside an owner, so every package is a sibling there and a reference like
 * `../../metamodels/datamodel` is written `../datamodel` (the names of metamodels and modules must therefore differ).
 *
 * It can be run again: repositories that exist are updated. A version is only published if it is valid semver, not already tagged
 * (`PackageVersionExistsError`: raise the version in the manifest) and higher than the last one tagged (`PackageVersionInvalidError`),
 * checked before anything of that package is written (a dry run makes the same checks). Packages before the failing one stay published,
 * so use `only` to publish one at a time. Publishing tags it and creates the release of the tag with the changelog since the previous version; a version
 * that does not match what the commits imply (feat → minor, fix → patch, breaking → major) is published anyway, with a warning.
 * The warning and `suggestedBump` only see the commits already in the repository (edits made there, e.g. from the LINEA editor): the
 * change in the folder being published is a single commit `Publish <name> <version>`, listed under «Other changes» in the release.
 */

const SKIPPED = new Set(['.git', 'node_modules', '.DS_Store'])

interface FileToPublish {
  path: string
  content: Buffer
}

const filesOf = (folder: string, prefix = ''): FileToPublish[] =>
  fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED.has(entry.name)) return []
    const full = path.join(folder, entry.name)
    return entry.isDirectory() ? filesOf(full, `${prefix}${entry.name}/`) : [{ path: `${prefix}${entry.name}`, content: fs.readFileSync(full) }]
  })

/** Where a package refers to another by `../../metamodels/x` (a sibling folder of a sibling folder), a host without groups needs `../x`. */
const flatten = (reference: string): string => reference.replace(/^\.\.\/\.\.\/(?:metamodels|modules)\//, '../')

/** The files of a package, with the references of its manifest as the host writes them. */
const filesFor = (kind: PackageKind, folder: string, flat: boolean): FileToPublish[] =>
  filesOf(folder).map((file) => {
    if (file.path !== KIND_DEFINITIONS[kind].manifest || !flat) return file
    const manifest = JSON.parse(file.content.toString('utf8'))
    const map = (record: Record<string, string> | undefined): Record<string, string> =>
      Object.fromEntries(Object.entries(record ?? {}).map(([reference, range]) => [flatten(reference), range]))
    const rewritten = kind === 'module'
      ? { ...manifest, requires: { ...manifest.requires, modules: map(manifest.requires?.modules), metamodels: map(manifest.requires?.metamodels) } }
      : { ...manifest, requires: map(manifest.requires) }
    return { ...file, content: Buffer.from(`${JSON.stringify(rewritten, null, 2)}\n`) }
  })

export interface PublishedPackage {
  kind: PackageKind
  name: string
  version: string
  /** Where it is, as the host shows it. */
  path: string
  status: 'published' | 'already-published' | 'dry-run'
  /** What the commits since the last published version imply (only when it was published and there was a version before). */
  suggestedBump?: BumpLevel | null
  /** Things worth knowing that did not stop it: the version does not match the commits, the release could not be made. */
  warnings?: string[]
}

export interface PublishFolderOptions {
  provider: GitProvider
  token: string
  /** The folder with `metamodels/` and `modules/`. */
  dir: string
  /** GitLab: the path of an existing group to publish under. GitHub: the user or organisation that owns the repositories. */
  root: string
  /** Only these kinds (both by default, metamodels first). */
  kinds?: PackageKind[]
  /** Only the package with this name. */
  only?: string
  dryRun?: boolean
  /** A version that is already published is reported (`already-published`) and left alone, instead of refused with `PackageVersionExistsError`. */
  skipPublished?: boolean
  /** Every package it publishes (or finds already published) is registered here, with the description of its manifest. */
  catalog?: PackageCatalog
  log?: (line: string) => void
}

export const publishFolder = async ({ provider, token, dir, root, kinds = ['metamodel', 'module'], only, dryRun = false, skipPublished = false, catalog, log = () => {} }: PublishFolderOptions): Promise<PublishedPackage[]> => {
  const flat = !provider.nestsNamespaces
  const published: PublishedPackage[] = []

  let rootNamespace: Namespace | null = null
  if (!dryRun) {
    rootNamespace = await provider.findNamespace({ token, fullPath: root })
    if (!rootNamespace) throw new Error(`${root} does not exist on ${provider.kind}: ${flat ? 'the owner of the repositories' : 'the group to publish under'} has to be there already.`)
  }

  for (const kind of kinds) {
    const definition = KIND_DEFINITIONS[kind]
    const folder = path.join(dir, definition.dir)
    if (!fs.existsSync(folder)) continue

    let namespaceId: Id | undefined
    let namespacePath = flat ? root : `${root}/${definition.dir}`
    if (rootNamespace) {
      if (flat) {
        namespaceId = rootNamespace.id
      } else {
        let sub = await provider.findNamespace({ token, fullPath: namespacePath })
        if (!sub) {
          log(`+ group ${namespacePath}`)
          sub = await provider.createNamespace({ token, name: definition.dir, parentId: rootNamespace.id })
        }
        namespaceId = sub.id
        namespacePath = sub.fullPath
      }
    }

    for (const name of fs.readdirSync(folder).sort()) {
      if (only !== undefined && name !== only) continue
      const packageDir = path.join(folder, name)
      const manifestPath = path.join(packageDir, definition.manifest)
      if (!fs.statSync(packageDir).isDirectory() || !fs.existsSync(manifestPath)) continue
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { version: string, description?: string }
      const repositoryPath = `${namespacePath}/${name}`
      if (dryRun) {
        // the same checks as the real run, against the tags of the repository when it is there already
        const existing = await provider.findRepository({ token, path: repositoryPath })
        const tags = existing ? await provider.listTags({ token, id: existing.id }) : []
        try {
          assertPublishable({ version: manifest.version, published: publishedVersions(tags), file: definition.manifest })
        } catch (error) {
          if (!skipPublished || !(error instanceof PackageVersionExistsError)) throw error
          published.push({ kind, name, version: manifest.version, path: repositoryPath, status: 'already-published' })
          continue
        }
        log(`- ${repositoryPath}  v${manifest.version}  (${filesFor(kind, packageDir, flat).length} files)`)
        published.push({ kind, name, version: manifest.version, path: repositoryPath, status: 'dry-run' })
        continue
      }

      let repository = await provider.findRepository({ token, path: repositoryPath })
      if (!repository) {
        repository = await provider.createRepository({ token, name, namespaceId, topics: [definition.topic], defaultBranch: 'main' })
      } else {
        await provider.addTopic({ token, id: repository.id, topic: definition.topic })
      }

      if (catalog) await catalog.add({ entry: entryFor({ kind, provider, path: repository.path, name, description: manifest.description }) })

      const tag = `v${manifest.version}`

      // an invalid, already published or lower version is refused here, before the files are touched
      let checked: Awaited<ReturnType<typeof preflight>>
      try {
        checked = await preflight({ provider, token, id: repository.id, version: manifest.version, file: definition.manifest })
      } catch (error) {
        if (!skipPublished || !(error instanceof PackageVersionExistsError)) throw error
        published.push({ kind, name, version: manifest.version, path: repository.path, status: 'already-published' })
        continue
      }
      const { suggestedBump, warnings } = checked
      for (const warning of warnings) log(`    warning: ${printable(warning)}`)

      const files = filesFor(kind, packageDir, flat)
      log(`- ${repository.path}  v${manifest.version}  (${files.length} files)`)
      const existing = new Set(await provider.listFiles({ token, id: repository.id, ref: 'main' }))
      await provider.commit({
        token,
        id: repository.id,
        branch: 'main',
        message: `Publish ${name} ${manifest.version}`,
        track: false,
        actions: files.map((file) => ({
          action: existing.has(file.path) ? 'update' as const : 'create' as const,
          path: file.path,
          content: file.content.toString('base64'),
          encoding: 'base64' as const
        }))
      })
      await provider.createTag({ token, id: repository.id, tag, ref: 'main', message: `Release ${manifest.version}` })
      forgetPackageTags(`${provider.kind}:${repository.path}`)
      const { release, warning } = await createPackageRelease({ provider, token, id: repository.id, tag, name })
      if (warning) {
        warnings.push(warning)
        log(`    warning: ${printable(warning)}`)
      }
      log(`    published ${tag}${release ? ' with its release' : ''}`)
      published.push({ kind, name, version: manifest.version, path: repository.path, status: 'published', suggestedBump, warnings })
    }
  }
  return published
}
