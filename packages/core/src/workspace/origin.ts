import fs from 'node:fs'
import path from 'node:path'
import { excludeFromGit } from './gitExclude.js'

/** Where a checkout came from: what `.linea/origin.json` of a cloned SPL, product, module or metamodel says. */
export interface Origin {
  kind: 'spl' | 'product' | 'module' | 'metamodel'
  name: string
  provider: 'local' | 'gitlab' | 'github'
  /** the id of the repository on the host (what the API takes) */
  projectId: number | string
  webUrl: string
  defaultBranch: string
  /** an SPL or a product: the LINEA server it was cloned from, and the ids it knows it by */
  server?: string
  lineId?: string
  productId?: string
  /** the LINEA web address of it */
  webUi?: string
  /** a module or metamodel: where `publish` puts it (the group on GitLab, the owner on GitHub), when that can be told from where it came from */
  publishRoot?: string
}

const ORIGIN_FILE = path.join('.linea', 'origin.json')

export function writeOrigin (dir: string, origin: Origin): void {
  fs.mkdirSync(path.join(dir, '.linea'), { recursive: true })
  fs.writeFileSync(path.join(dir, ORIGIN_FILE), `${JSON.stringify(origin, null, 2)}\n`)
  // it says where the checkout came from, not what it contains: it is not for the repository
  excludeFromGit(dir, '.linea/origin.json')
}

export function readOrigin (dir: string): Origin | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, ORIGIN_FILE), 'utf8')) as Origin
  } catch {
    return undefined
  }
}
