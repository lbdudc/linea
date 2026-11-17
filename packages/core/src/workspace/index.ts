/**
 * A workspace on disk: SPLs, their products, and the modules and metamodels next to them, as plain folders (LOCAL mode of the CLI).
 * What it does with them is what the server does with the same things on a git host: scaffold, check, derive.
 */
export * from './local.js'
export * from './modular.js'
export * from './origin.js'
export { excludeFromGit } from './gitExclude.js'
export { configureWorkspace } from './host.js'
export type { WorkspaceHost } from './host.js'
export * from './context.js'
export * from './operations.js'
