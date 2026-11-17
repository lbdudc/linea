import fs from 'node:fs'
import path from 'node:path'

/**
 * Where the current folder is, the way git knows which repository you are in: a workspace (`.linea/workspace.json`), an SPL (it
 * has `spl.json`, or `src/platform`) and, inside an SPL, a product (`<spl>/<product>/.linea/spec.json`).
 */
export interface FolderContext {
  workspace?: string
  line?: { name: string, dir: string }
  product?: { name: string, dir: string }
  /** a module or metamodel: a folder with `module.json` / `metamodel.json` */
  package?: { kind: 'module' | 'metamodel', name: string, dir: string }
}

export const WORKSPACE_FILE = path.join('.linea', 'workspace.json')

const isLine = (dir: string): boolean =>
  fs.existsSync(path.join(dir, 'spl.json')) || fs.existsSync(path.join(dir, 'src', 'platform'))

const isProduct = (dir: string): boolean => fs.existsSync(path.join(dir, '.linea', 'spec.json'))

export function findContext(start: string): FolderContext {
  const ctx: FolderContext = {}
  let dir = path.resolve(start)
  let child: string | undefined
  for (;;) {
    if (!ctx.package && !ctx.line) {
      const kind = fs.existsSync(path.join(dir, '.linea', 'module.json')) ? 'module' : fs.existsSync(path.join(dir, 'metamodel.json')) ? 'metamodel' : undefined
      if (kind) ctx.package = { kind, name: path.basename(dir), dir }
    }
    if (!ctx.line && isLine(dir)) {
      ctx.line = { name: path.basename(dir), dir }
      if (child && isProduct(child)) ctx.product = { name: path.basename(child), dir: child }
    }
    if (!ctx.workspace && fs.existsSync(path.join(dir, WORKSPACE_FILE))) ctx.workspace = dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    child = dir
    dir = parent
  }
  // a product folder is not an SPL of its own: it was found as the child of the line, nothing else to do
  return ctx
}

/** A folder becomes a workspace: the place the modules and metamodels of an SPL are looked for. */
export function initWorkspace(dir: string): string {
  const abs = path.resolve(dir)
  fs.mkdirSync(path.join(abs, '.linea'), { recursive: true })
  fs.mkdirSync(path.join(abs, 'modules'), { recursive: true })
  fs.mkdirSync(path.join(abs, 'metamodels'), { recursive: true })
  const file = path.join(abs, WORKSPACE_FILE)
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ version: 1 }, null, 2) + '\n')
  return abs
}
