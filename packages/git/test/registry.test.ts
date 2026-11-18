import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ModuleCheckError, ModuleManifestError, resolveSpl } from '@lbdudc/linea-core'
import {
  GitHubClient, GitHubProvider, GitLabProvider, PackageNotFoundError, PackageVersionExistsError, PackageVersionInvalidError, clearGitHubCache,
  assertPublishable, bumpWarning, createGitCatalog, createPackage, createPackageSource, getPackage, getPackageChangelog, listPackageChangelogs, suggestBump, listPackages, listRegisteredPackages, publishFolder, suggestPackages, publishPackage, previewPublication, readPackageFile, savePackageFile, savePackageFiles,
  type GitConfig, type GitProvider
} from '../src/index.js'
import { startGithubDouble, startGitlabDouble } from '../src/testing/index.js'

const token = 'tok'

interface Harness {
  name: string
  start: () => Promise<{ provider: () => GitProvider, config: GitConfig, root: string, registry: string, locationOf: (kind: 'module' | 'metamodel', name: string) => string, reset: () => void, close: () => Promise<void> }>
}

const harnesses: Harness[] = [
  {
    name: 'GitLab',
    start: async () => {
      const double = await startGitlabDouble()
      return {
        provider: () => new GitLabProvider({ url: double.url }),
        config: { provider: 'gitlab', gitlab: { url: double.url } },
        root: 'registry',
        registry: 'gitlab:registry/index',
        locationOf: (kind, name) => `gitlab:registry/${kind === 'module' ? 'modules' : 'metamodels'}/${name}`,
        reset: () => double.reset(),
        close: () => double.close()
      }
    }
  },
  {
    name: 'GitHub',
    start: async () => {
      const double = await startGithubDouble()
      return {
        provider: () => new GitHubProvider({ client: new GitHubClient({ apiUrl: double.url }), pollMs: 2 }),
        config: { provider: 'github', github: { webUrl: double.url, apiUrl: double.url } },
        root: 'dev',
        registry: 'github:dev/linea-registry',
        locationOf: (_kind, name) => `github:dev/${name}`,
        reset: () => { double.reset(); clearGitHubCache() },
        close: () => double.close()
      }
    }
  }
]

/** A folder of packages like the workspace: a metamodel, and a module that needs it (by a path that works under a group). */
const workspace = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-git-'))
  const write = (file: string, content: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), content)
  }
  write('metamodels/shapes/metamodel.json', JSON.stringify({ name: 'shapes', version: '1.0.0', requires: {} }))
  write('metamodels/shapes/shapes.langium', "grammar Shapes\n\nentry ShapesModel: 'shapes' name=ID? (items+=Item)*;\n\nItem: 'item' name=ID;\n\nterminal ID: /[_a-zA-Z][\\w_-]*/;\nhidden terminal WS: /\\s+/;\n")
  write('modules/draw/.linea/module.json', JSON.stringify({ name: 'draw', version: '1.2.0', requires: { modules: {}, metamodels: { '../../metamodels/shapes': '^1.0.0' } }, offers: {} }))
  write('modules/draw/model.uvl', 'features\n\tDraw\n\t\toptional\n\t\t\tCircles\n')
  return dir
}

for (const harness of harnesses) {
  describe(`the registry on ${harness.name}`, () => {
    let host: Awaited<ReturnType<Harness['start']>>
    beforeAll(async () => { host = await harness.start() })
    afterEach(() => host.reset())
    afterAll(async () => { await host.close() })

    /** A group (or, on GitHub, nothing: the account is already there) to publish under. */
    const root = async (provider: GitProvider): Promise<string> => {
      if (provider.nestsNamespaces) await provider.createNamespace({ token, name: host.root })
      return host.root
    }

    it('creates a package with the files of its kind, lists it with its versions, and reads it', async () => {
      const provider = host.provider()
      const created = await createPackage({ provider, token, kind: 'module', name: 'core', description: 'The core' })
      expect(created).toMatchObject({ kind: 'module', name: 'core', versions: [], latest: null, host: provider.kind })

      const listed = await listPackages({ provider: host.provider(), token, kind: 'module' })
      expect(listed.map((p) => p.name)).toEqual(['core'])
      expect(await listPackages({ provider: host.provider(), token, kind: 'metamodel' })).toEqual([])

      const detail = await getPackage({ provider: host.provider(), token, kind: 'module', id: created.id as number })
      expect(detail.files).toEqual(expect.arrayContaining(['.linea/module.json', '.linea/model.uvl']))
      expect(detail.manifest).toMatchObject({ name: 'core', version: '0.1.0' })
      const file = await readPackageFile({ provider: host.provider(), token, kind: 'module', id: created.id as number, path: '.linea/model.uvl' })
      expect(file.content).toContain('Core')
    })

    it('does not take a repository for a package of the other kind, or a path that leaves the repository', async () => {
      const created = await createPackage({ provider: host.provider(), token, kind: 'module', name: 'core' })
      await expect(getPackage({ provider: host.provider(), token, kind: 'metamodel', id: created.id as number })).rejects.toBeInstanceOf(PackageNotFoundError)
      await expect(readPackageFile({ provider: host.provider(), token, kind: 'module', id: created.id as number, path: '../secret' })).rejects.toBeInstanceOf(PackageNotFoundError)
      await expect(createPackage({ provider: host.provider(), token, kind: 'module', name: 'not a name!' })).rejects.toThrow(/not a valid package name/)
    })

    it('saves and deletes files, checking a manifest before it is saved', async () => {
      const created = await createPackage({ provider: host.provider(), token, kind: 'module', name: 'core' })
      const id = created.id as number
      await expect(savePackageFile({ provider: host.provider(), token, kind: 'module', id, path: '.linea/module.json', content: '{' })).rejects.toBeInstanceOf(ModuleManifestError)
      expect(await savePackageFile({ provider: host.provider(), token, kind: 'module', id, path: 'code/a.js', content: 'x' })).toEqual({ path: 'code/a.js', committed: true })
      expect(await savePackageFile({ provider: host.provider(), token, kind: 'module', id, path: 'code/a.js', content: 'x' })).toEqual({ path: 'code/a.js', committed: false })
      expect(await savePackageFile({ provider: host.provider(), token, kind: 'module', id, path: 'code/a.js', content: null })).toEqual({ path: 'code/a.js', committed: true })
      await expect(savePackageFile({ provider: host.provider(), token, kind: 'module', id, path: '.linea/module.json', content: null })).rejects.toThrow(/cannot be deleted/)
    })

    it('saves several files in one commit, and writes nothing when one of them is not valid', async () => {
      const provider = host.provider()
      const created = await createPackage({ provider, token, kind: 'metamodel', name: 'shapes' })
      const id = created.id as number
      const commits = async () => (await host.provider().getCommits({ token, id, ref: 'main' })).length
      const before = await commits()

      const saved = await savePackageFiles({ provider: host.provider(), token, kind: 'metamodel', id, files: { 'shapes.langium': 'grammar Shapes\n', 'shapes.constraints.js': 'return []', 'README.md': null }, message: 'Edit shapes' })
      expect(saved).toEqual({ paths: ['shapes.langium', 'shapes.constraints.js', 'README.md'], committed: true })
      expect(await commits()).toBe(before + 1)
      const files = await getPackage({ provider: host.provider(), token, kind: 'metamodel', id })
      expect(files.files).toEqual(expect.arrayContaining(['shapes.constraints.js']))
      expect(files.files).not.toContain('README.md')

      // the same content again changes nothing
      expect((await savePackageFiles({ provider: host.provider(), token, kind: 'metamodel', id, files: { 'shapes.constraints.js': 'return []' } })).committed).toBe(false)

      // a manifest that is not valid, a path that leaves the repository, or a manifest to delete: nothing at all is written
      await expect(savePackageFiles({ provider: host.provider(), token, kind: 'metamodel', id, files: { 'a.js': 'x', 'metamodel.json': '{' } })).rejects.toBeInstanceOf(ModuleManifestError)
      await expect(savePackageFiles({ provider: host.provider(), token, kind: 'metamodel', id, files: { 'a.js': 'x', '../secret': 'y' } })).rejects.toBeInstanceOf(PackageNotFoundError)
      await expect(savePackageFiles({ provider: host.provider(), token, kind: 'metamodel', id, files: { 'metamodel.json': null } })).rejects.toThrow(/cannot be deleted/)
      expect((await getPackage({ provider: host.provider(), token, kind: 'metamodel', id })).files).not.toContain('a.js')
      expect(await commits()).toBe(before + 1)
    })

    it('publishes a version once, raising it first when asked, and only if it passes its checks', async () => {
      const created = await createPackage({ provider: host.provider(), token, kind: 'module', name: 'core' })
      const id = created.id as number
      const ok = async () => ({ ok: true, diagnostics: [] })

      const first = await publishPackage({ provider: host.provider(), token, kind: 'module', id, check: ok })
      expect(first).toMatchObject({ version: '0.1.0', tag: 'v0.1.0' })
      expect(first.location.startsWith(`${host.provider().kind}:`)).toBe(true)
      await expect(publishPackage({ provider: host.provider(), token, kind: 'module', id, check: ok })).rejects.toBeInstanceOf(PackageVersionExistsError)

      const bumped = await publishPackage({ provider: host.provider(), token, kind: 'module', id, bump: 'minor', check: ok })
      expect(bumped.version).toBe('0.2.0')
      expect((await listPackages({ provider: host.provider(), token, kind: 'module' }))[0]?.versions).toEqual(['0.2.0', '0.1.0'])

      await expect(publishPackage({ provider: host.provider(), token, kind: 'module', id, bump: 'patch', check: async () => ({ ok: false, diagnostics: [{ severity: 'error', package: 'x', message: 'no' }] }) }))
        .rejects.toBeInstanceOf(ModuleCheckError)
      expect((await listPackages({ provider: host.provider(), token, kind: 'module' }))[0]?.versions).toEqual(['0.2.0', '0.1.0'])
    })

    describe('releases and versions', () => {
      const ok = async () => ({ ok: true, diagnostics: [] })
      const setVersion = (id: number, version: string) => savePackageFile({
        provider: host.provider(), token, kind: 'module', id, path: '.linea/module.json', message: `chore: version ${version}`,
        content: JSON.stringify({ name: 'core', version, requires: { modules: {}, metamodels: {} }, offers: {} })
      })

      it('creates the tag and the release on the first publication', async () => {
        const id = (await createPackage({ provider: host.provider(), token, kind: 'module', name: 'core' })).id as number
        const first = await publishPackage({ provider: host.provider(), token, kind: 'module', id, check: ok })
        expect(first).toMatchObject({ tag: 'v0.1.0', suggestedBump: null, warnings: [] })
        const release = await host.provider().getRelease({ token, id, tag: 'v0.1.0' })
        expect(release).toMatchObject({ tag: 'v0.1.0', name: 'core v0.1.0' })
        expect(first.release?.tag).toBe('v0.1.0')
      })

      it('previews a publication without doing it: the version, the bump the commits imply and how much there is to release', async () => {
        const id = (await createPackage({ provider: host.provider(), token, kind: 'module', name: 'core' })).id as number
        const before = await previewPublication({ provider: host.provider(), token, kind: 'module', id, version: '0.1.0' })
        expect(before).toMatchObject({ latest: null, versionError: null, suggestedBump: null, commitsSince: null, warnings: [] })
        await publishPackage({ provider: host.provider(), token, kind: 'module', id, check: ok })
        const again = await previewPublication({ provider: host.provider(), token, kind: 'module', id, version: '0.1.0' })
        expect(again).toMatchObject({ latest: '0.1.0', commitsSince: 0 })
        expect(again.versionError).toContain('already published')
        await savePackageFile({ provider: host.provider(), token, kind: 'module', id, path: 'a.txt', content: 'a', message: 'feat(draw): add circles' })
        const next = await previewPublication({ provider: host.provider(), token, kind: 'module', id, version: '0.1.1' })
        expect(next).toMatchObject({ versionError: null, suggestedBump: 'minor', commitsSince: 1 })
        expect(next.warnings).toEqual([expect.stringContaining('imply a minor one')])
        expect((await listPackages({ provider: host.provider(), token, kind: 'module' }))[0]?.versions).toEqual(['0.1.0'])
      })

      it('puts the commits since the previous version in the release, by section, and warns when the version does not match them', async () => {
        const id = (await createPackage({ provider: host.provider(), token, kind: 'module', name: 'core' })).id as number
        await publishPackage({ provider: host.provider(), token, kind: 'module', id, check: ok })
        await savePackageFile({ provider: host.provider(), token, kind: 'module', id, path: 'a.txt', content: 'a', message: 'feat(draw): add circles' })
        await savePackageFile({ provider: host.provider(), token, kind: 'module', id, path: 'b.txt', content: 'b', message: 'fix: squares overlap' })
        await savePackageFile({ provider: host.provider(), token, kind: 'module', id, path: 'c.txt', content: 'c', message: 'chore: tidy' })

        // a patch bump, when a feature came in: published, and said
        const next = await publishPackage({ provider: host.provider(), token, kind: 'module', id, bump: 'patch', check: ok })
        expect(next).toMatchObject({ version: '0.1.1', suggestedBump: 'minor' })
        expect(next.warnings).toEqual([expect.stringContaining('imply a minor one')])
        const notes = (await host.provider().getRelease({ token, id, tag: 'v0.1.1' }))!.description
        expect(notes).toContain('### Features')
        expect(notes).toContain('**draw:** add circles')
        expect(notes).toContain('### Fixes')
        expect(notes).toContain('squares overlap')
        expect(notes).not.toContain('tidy')

        // matching the commits gives no warning
        await savePackageFile({ provider: host.provider(), token, kind: 'module', id, path: 'd.txt', content: 'd', message: 'feat!: drop circles' })
        const major = await publishPackage({ provider: host.provider(), token, kind: 'module', id, bump: 'major', check: ok })
        expect(major).toMatchObject({ version: '1.0.0', suggestedBump: 'major', warnings: [] })
        expect((await host.provider().getRelease({ token, id, tag: 'v1.0.0' }))!.description).toContain('### Breaking changes')
      })

      it('refuses a version that is lower than the last one, and changes nothing', async () => {
        const id = (await createPackage({ provider: host.provider(), token, kind: 'module', name: 'core' })).id as number
        await setVersion(id, '1.2.0')
        await publishPackage({ provider: host.provider(), token, kind: 'module', id, check: ok })

        await setVersion(id, '1.1.0')
        const failure = await publishPackage({ provider: host.provider(), token, kind: 'module', id, check: ok }).catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(PackageVersionInvalidError)
        expect((failure as Error).message).toMatch(/1\.1\.0 is lower than v1\.2\.0/)

        await setVersion(id, '1.2.0')
        await expect(publishPackage({ provider: host.provider(), token, kind: 'module', id, check: ok })).rejects.toBeInstanceOf(PackageVersionExistsError)
        expect((await listPackages({ provider: host.provider(), token, kind: 'module' }))[0]?.versions).toEqual(['1.2.0'])
        expect(await host.provider().getRelease({ token, id, tag: 'v1.1.0' })).toBeNull()
      })

      it('exposes the changelog of each version, from its release or from its commits', async () => {
        const provider = host.provider()
        const id = (await createPackage({ provider, token, kind: 'module', name: 'core' })).id as number
        await publishPackage({ provider, token, kind: 'module', id, check: ok })
        await savePackageFile({ provider, token, kind: 'module', id, path: 'a.txt', content: 'a', message: 'feat: add circles' })
        await publishPackage({ provider, token, kind: 'module', id, bump: 'minor', check: ok })

        const one = await getPackageChangelog({ provider, token, kind: 'module', id, version: '0.2.0' })
        expect(one).toMatchObject({ version: '0.2.0', tag: 'v0.2.0', source: 'release' })
        expect(one.markdown).toContain('### Features')
        expect((await getPackageChangelog({ provider, token, kind: 'module', id, version: 'v0.2.0' })).markdown).toBe(one.markdown)
        await expect(getPackageChangelog({ provider, token, kind: 'module', id, version: '9.9.9' })).rejects.toBeInstanceOf(PackageNotFoundError)
        await expect(getPackageChangelog({ provider, token, kind: 'module', id, version: '../x' })).rejects.toBeInstanceOf(PackageNotFoundError)

        // a version tagged by hand has no release: its changelog is worked out
        await savePackageFile({ provider, token, kind: 'module', id, path: 'b.txt', content: 'b', message: 'fix: edges' })
        await provider.createTag({ token, id, tag: 'v0.2.1', ref: 'main' })
        const all = await listPackageChangelogs({ provider, token, kind: 'module', id })
        expect(all.map((c) => [c.version, c.source])).toEqual([['0.2.1', 'commits'], ['0.2.0', 'release'], ['0.1.0', 'release']])
        expect(all[0]?.markdown).toContain('edges')
      })

      it('works out versions and bumps on their own', () => {
        expect(assertPublishable({ version: '1.3.0', published: ['1.2.0'], file: 'm.json' })).toBe('1.3.0')
        expect(() => assertPublishable({ version: '1.3', published: [], file: 'm.json' })).toThrow(PackageVersionInvalidError)
        expect(() => assertPublishable({ version: undefined, published: [], file: 'm.json' })).toThrow(PackageVersionInvalidError)
        expect(() => assertPublishable({ version: '1.2.0', published: ['1.2.0'], file: 'm.json' })).toThrow(PackageVersionExistsError)
        expect(suggestBump([{ type: 'fix', breaking: false }, { type: 'feat', breaking: false }])).toBe('minor')
        expect(suggestBump([{ type: 'fix', breaking: false }, { type: 'refactor', breaking: true }])).toBe('major')
        expect(suggestBump([{ type: 'fix', breaking: false }])).toBe('patch')
        expect(suggestBump([{ type: null, breaking: false }])).toBeNull()
        expect(bumpWarning({ latest: '1.2.0', version: '1.2.1', suggested: 'minor' })).toMatch(/patch bump over 1\.2\.0.*minor/)
        expect(bumpWarning({ latest: '1.2.0', version: '1.3.0', suggested: 'minor' })).toBeNull()
        expect(bumpWarning({ latest: undefined, version: '1.0.0', suggested: null })).toBeNull()
      })

      it('counts a prerelease tag: nothing lower than it is accepted', async () => {
        const provider = host.provider()
        const id = (await createPackage({ provider, token, kind: 'module', name: 'core' })).id as number
        await provider.createTag({ token, id, tag: 'v1.3.0-rc.1', ref: 'main' }) // manifests cannot hold one, a tag made by hand can
        await setVersion(id, '1.2.5')
        await expect(publishPackage({ provider, token, kind: 'module', id, check: ok })).rejects.toBeInstanceOf(PackageVersionInvalidError)
        await setVersion(id, '1.3.0')
        expect((await publishPackage({ provider, token, kind: 'module', id, check: ok })).tag).toBe('v1.3.0')
      })

      it('publishes, with a warning, when the release cannot be created', async () => {
        const provider = host.provider()
        const id = (await createPackage({ provider, token, kind: 'module', name: 'core' })).id as number
        provider.createRelease = async () => { throw new Error('release \u001b[31mboom') }
        const result = await publishPackage({ provider, token, kind: 'module', id, check: ok })
        expect(result).toMatchObject({ tag: 'v0.1.0', release: null })
        expect(result.warnings).toEqual(['v0.1.0 was published but its release could not be created: release  [31mboom'])
        expect((await listPackages({ provider: host.provider(), token, kind: 'module' }))[0]?.versions).toEqual(['0.1.0'])
      })

      it('creates the release when it publishes a folder, and refuses a lower version before writing', async () => {
        const dir = workspace()
        const provider = host.provider()
        const where = await root(provider)
        const first = await publishFolder({ provider, token, dir, root: where })
        expect(first.every((p) => p.status === 'published' && p.warnings?.length === 0)).toBe(true)
        const [module] = await listPackages({ provider: host.provider(), token, kind: 'module' })
        const [metamodel] = await listPackages({ provider: host.provider(), token, kind: 'metamodel' })
        expect(await provider.getRelease({ token, id: module?.id as number, tag: 'v1.2.0' })).toMatchObject({ tag: 'v1.2.0', name: 'draw v1.2.0' })
        expect(await provider.getRelease({ token, id: metamodel?.id as number, tag: 'v1.0.0' })).not.toBeNull()

        const manifestFile = path.join(dir, 'modules/draw/.linea/module.json')
        const manifest = (version: string) => JSON.stringify({ name: 'draw', version, requires: { modules: {}, metamodels: { '../../metamodels/shapes': '^1.0.0' } }, offers: {} })
        fs.writeFileSync(manifestFile, manifest('1.1.0'))
        await expect(publishFolder({ provider: host.provider(), token, dir, root: where, only: 'draw' })).rejects.toBeInstanceOf(PackageVersionInvalidError)
        fs.writeFileSync(manifestFile, manifest('one'))
        await expect(publishFolder({ provider: host.provider(), token, dir, root: where, only: 'draw', dryRun: true })).rejects.toBeInstanceOf(PackageVersionInvalidError)
        expect((await listPackages({ provider: host.provider(), token, kind: 'module' }))[0]?.versions).toEqual(['1.2.0'])

        // a patch where the commits of the repository imply a feature is published, with the warning
        await savePackageFile({ provider: host.provider(), token, kind: 'module', id: module?.id as number, path: 'extra.txt', content: 'x', message: 'feat: more shapes' })
        fs.writeFileSync(manifestFile, manifest('1.2.1'))
        const [patched] = await publishFolder({ provider: host.provider(), token, dir, root: where, only: 'draw' })
        expect(patched).toMatchObject({ status: 'published', suggestedBump: 'minor' })
        expect(patched?.warnings?.[0]).toMatch(/imply a minor one/)
        expect((await provider.getRelease({ token, id: module?.id as number, tag: 'v1.2.1' }))!.description).toContain('more shapes')
      })
    })

    it('publishes the packages of a folder, and linea-core resolves them from there', async () => {
      const dir = workspace()
      const provider = host.provider()
      const log: string[] = []
      const published = await publishFolder({ provider, token, dir, root: await root(provider), log: (line) => log.push(line) })
      expect(published.map((p) => [p.kind, p.name, p.status])).toEqual([['metamodel', 'shapes', 'published'], ['module', 'draw', 'published']])

      // what an SPL names them by, and what the host holds
      const [module] = await listPackages({ provider: host.provider(), token, kind: 'module' })
      expect(module?.location).toBe(host.locationOf('module', 'draw'))
      expect(module?.versions).toEqual(['1.2.0'])
      const manifest = JSON.parse((await provider.readFile({ token, id: module?.id as number, path: '.linea/module.json', ref: 'main' }))!.toString('utf8'))
      expect(Object.keys(manifest.requires.metamodels)).toEqual([provider.nestsNamespaces ? '../../metamodels/shapes' : '../shapes'])

      const resolved = await resolveSpl({
        spl: { name: 'spl', kind: 'modular', metamodels: {}, modules: { [host.locationOf('module', 'draw')]: '^1.0.0' } },
        source: createPackageSource(host.config, { token, userId: 'u' })
      })
      expect(resolved.modules.map((m) => m.manifest.name)).toEqual(['draw'])
      expect(resolved.metamodels.map((m) => m.manifest.name)).toEqual(['shapes'])
      expect(resolved.lock.packages[host.locationOf('module', 'draw')]?.revision).toBeTruthy()
    })

    it('refuses a version that is already published when it is run again, and publishes what is new', async () => {
      const dir = workspace()
      const provider = host.provider()
      const where = await root(provider)
      await publishFolder({ provider, token, dir, root: where })
      // the same versions again: an error that says so, and the dry run says the same; nothing changes
      await expect(publishFolder({ provider: host.provider(), token, dir, root: where })).rejects.toBeInstanceOf(PackageVersionExistsError)
      await expect(publishFolder({ provider: host.provider(), token, dir, root: where })).rejects.toThrow(/v1\.0\.0 is already published/)
      await expect(publishFolder({ provider: host.provider(), token, dir, root: where, dryRun: true })).rejects.toBeInstanceOf(PackageVersionExistsError)
      expect((await listPackages({ provider: host.provider(), token, kind: 'module' }))[0]?.versions).toEqual(['1.2.0'])

      fs.writeFileSync(path.join(dir, 'modules/draw/.linea/module.json'), JSON.stringify({ name: 'draw', version: '1.3.0', requires: { modules: {}, metamodels: { '../../metamodels/shapes': '^1.0.0' } }, offers: {} }))
      const next = await publishFolder({ provider: host.provider(), token, dir, root: where, only: 'draw' })
      expect(next.map((p) => [p.name, p.status])).toEqual([['draw', 'published']])
      expect((await listPackages({ provider: host.provider(), token, kind: 'module' }))[0]?.versions).toEqual(['1.3.0', '1.2.0'])
    })

    it('says what it would do without doing it, and refuses a root that does not exist', async () => {
      const dir = workspace()
      const dry = await publishFolder({ provider: host.provider(), token, dir, root: 'nowhere', dryRun: true })
      expect(dry.map((p) => p.status)).toEqual(['dry-run', 'dry-run'])
      expect(await listPackages({ provider: host.provider(), token, kind: 'module' })).toEqual([])
      await expect(publishFolder({ provider: host.provider(), token, dir, root: 'nowhere-at-all' })).rejects.toThrow(/does not exist/)
    })
    describe('the catalog', () => {
      const catalogOf = (): ReturnType<typeof createGitCatalog> => createGitCatalog({ provider: host.provider(), token, location: host.registry })
      const entry = (name: string, kind: 'module' | 'metamodel' = 'module') => ({ kind, location: host.locationOf(kind, name), name, addedAt: '2026-10-07T00:00:00.000Z' })

      it('is empty before there is a repository, which the first registration makes', async () => {
        const provider = host.provider()
        await root(provider)
        expect(await catalogOf().list()).toEqual([])
        expect(await provider.findRepository({ token, path: host.registry.slice(host.registry.indexOf(':') + 1) })).toBeNull()
        await catalogOf().add({ entry: entry('core') })
        const repository = await provider.findRepository({ token, path: host.registry.slice(host.registry.indexOf(':') + 1) })
        expect(repository?.topics).toContain('linea-registry')
        expect(JSON.parse((await provider.readFile({ token, id: repository!.id, path: 'registry.json', ref: 'main' }))!.toString('utf8')).packages).toHaveProperty([host.locationOf('module', 'core')])
      })

      it('keeps what was registered for the next process, and unregisters', async () => {
        await root(host.provider())
        await catalogOf().add({ entry: entry('core') })
        await catalogOf().add({ entry: entry('shapes', 'metamodel') })
        expect((await catalogOf().list()).map((e) => e.name)).toEqual(expect.arrayContaining(['core', 'shapes']))
        expect((await catalogOf().list({ kind: 'metamodel' })).map((e) => e.name)).toEqual(['shapes'])
        await catalogOf().remove({ location: host.locationOf('module', 'core') })
        expect((await catalogOf().list()).map((e) => e.name)).toEqual(['shapes'])
      })

      it('does not lose a registration when several are made at once', async () => {
        await root(host.provider())
        const catalog = catalogOf()
        await Promise.all(['a', 'b', 'c', 'd'].map((name) => catalog.add({ entry: entry(name) })))
        expect((await catalogOf().list()).map((e) => e.name)).toEqual(['a', 'b', 'c', 'd'])
      })

      it('registers what it creates or publishes, and lists it with its versions', async () => {
        const provider = host.provider()
        const where = await root(provider)
        const catalog = catalogOf()
        await publishFolder({ provider, token, dir: workspace(), root: where, catalog })
        const made = await createPackage({ provider: host.provider(), token, kind: 'module', name: 'extra', description: 'More', namespaceId: undefined, catalog })
        expect((await catalog.list()).map((e) => e.name).sort()).toEqual(['draw', 'extra', 'shapes'])

        const source = createPackageSource(host.config, { token, userId: 'u' })
        const modules = await listRegisteredPackages({ provider: host.provider(), token, kind: 'module', catalog, source })
        expect(modules.map((p) => [p.name, p.versions])).toEqual(expect.arrayContaining([['draw', ['1.2.0']]]))
        expect(modules.find((p) => p.name === 'extra')).toMatchObject({ id: made.id, description: 'More', versions: [] })
        expect(modules.some((p) => p.unavailable)).toBe(false)
      })

      it('lists an entry it cannot reach as unavailable, and suggests only what is not registered', async () => {
        const provider = host.provider()
        const where = await root(provider)
        await publishFolder({ provider, token, dir: workspace(), root: where })
        const catalog = catalogOf()
        await catalog.add({ entry: entry('gone') })
        await catalog.add({ entry: entry('draw') })

        const source = createPackageSource(host.config, { token, userId: 'u' })
        const listed = await listRegisteredPackages({ provider: host.provider(), token, kind: 'module', catalog, source })
        expect(listed.find((p) => p.name === 'gone')).toMatchObject({ unavailable: true, versions: [] })
        expect(listed.find((p) => p.name === 'draw')?.unavailable).toBeUndefined()

        await createPackage({ provider: host.provider(), token, kind: 'module', name: 'loose' })
        const suggested = await suggestPackages({ provider: host.provider(), token, kind: 'module', catalog })
        expect(suggested.map((p) => p.name)).toEqual(['loose'])
      })

      it('refuses a registry that is on another host', async () => {
        expect(() => createGitCatalog({ provider: host.provider(), token, location: 'other:x/y' })).toThrow(/is not on/)
      })
    })
  })
}
