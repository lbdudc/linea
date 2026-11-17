import type { MetamodelEngine } from '../modules/index.js'
import type { PackageSource } from '../modules/index.js'
import { InvalidArgumentError } from '../errors.js'

/**
 * What a workspace needs from whoever embeds it, and linea-core does not have: a metamodel engine (bango) and, when the workspace
 * may use packages of a git host, a way to put that host behind the folders' own source. Set once, before the first call.
 */
export interface WorkspaceHost {
  createEngine: () => MetamodelEngine
  /** wraps the workspace's own package source so a location of a git host resolves too (default: the folders only) */
  sourceOf?: (folders: PackageSource) => PackageSource
}

let host: WorkspaceHost | undefined

export const configureWorkspace = (next: WorkspaceHost): void => {
  host = next
}

const workspaceHost = (): WorkspaceHost => {
  if (!host) throw new InvalidArgumentError('The workspace has no metamodel engine: call configureWorkspace({ createEngine }) first.')
  return host
}

export const createEngine = (): MetamodelEngine => workspaceHost().createEngine()
export const packageSourceOf = (folders: PackageSource): PackageSource => workspaceHost().sourceOf?.(folders) ?? folders
