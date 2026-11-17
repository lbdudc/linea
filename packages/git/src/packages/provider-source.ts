import { ModuleResolutionError, type PackageFiles, type PackageSource } from '@lbdudc/linea-core'
import type { GitProvider } from '../provider.js'
import { repositoryFiles } from './repository-files.js'

const VERSION_TAG = /^v?(\d+\.\d+\.\d+)$/

/**
 * Where the packages of a host that is read through its own `GitProvider` come from (the `local` host): a package's location is
 * `<scheme>:<path>`, its versions the git tags `vX.Y.Z`. There is nothing to cache: the repositories are on this machine.
 */
export class ProviderPackageSource implements PackageSource {
  private readonly refOf = new Map<string, string>()

  constructor(private readonly options: {
    scheme: string
    provider: GitProvider
    token: string
    /** Packages read from a branch as one version, instead of from their tags: to check what has not been published yet. */
    overrides?: Record<string, { version: string, ref: string }>
  }) {}

  private pathOf(location: string): string {
    const prefix = `${this.options.scheme}:`
    if (!location.startsWith(prefix) || location.length === prefix.length) {
      throw new ModuleResolutionError(`"${location}" is not a ${this.options.scheme} location (${prefix}group/project).`)
    }
    return location.slice(prefix.length)
  }

  private async repository(location: string) {
    const repository = await this.options.provider.findRepository({ token: this.options.token, path: this.pathOf(location) })
    if (!repository) throw new ModuleResolutionError(`${location} does not exist, or your account has no access to it.`)
    return repository
  }

  async listVersions({ location }: { location: string }): Promise<string[]> {
    const override = this.options.overrides?.[location]
    if (override) return [override.version]
    const repository = await this.repository(location)
    const versions: string[] = []
    for (const tag of await this.options.provider.listTags({ token: this.options.token, id: repository.id })) {
      const match = VERSION_TAG.exec(tag.name)
      if (!match) continue
      this.refOf.set(`${location}@${match[1]}`, tag.name)
      versions.push(match[1] as string)
    }
    return versions
  }

  private ref(location: string, version: string): string {
    return this.options.overrides?.[location]?.ref ?? this.refOf.get(`${location}@${version}`) ?? `v${version}`
  }

  async open({ location, version }: { location: string, version: string }): Promise<PackageFiles> {
    const repository = await this.repository(location)
    return repositoryFiles({ provider: this.options.provider, token: this.options.token, id: repository.id, ref: this.ref(location, version) })
  }

  async revision({ location, version }: { location: string, version: string }): Promise<string | undefined> {
    if (this.options.overrides?.[location]) return undefined
    const repository = await this.repository(location)
    const tag = await this.options.provider.getTag({ token: this.options.token, id: repository.id, tag: this.ref(location, version) })
    return tag?.commitId
  }
}
