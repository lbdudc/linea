import fs from 'node:fs'
import path from 'node:path'
import { InvalidArgumentError } from '../errors.js'

/** The annotation delimiters of an SPL, as its platform `config.json` declares them. */
export interface LeftoverDelimiters {
  readonly delimiters: readonly { readonly start: string, readonly end: string }[]
  readonly ignore?: readonly string[]
}

export interface Leftover {
  /** Path relative to the checked directory, with forward slashes. */
  readonly file: string
  readonly line: number
  readonly delimiter: string
}

const ALWAYS_SKIPPED = new Set(['.git', 'node_modules'])

const isBinary = (content: Buffer): boolean => content.subarray(0, 8000).includes(0)

const walk = (dir: string, skipped: ReadonlySet<string>, visit: (file: string) => void): void => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, skipped, visit)
    else if (entry.isFile()) visit(full)
  }
}

/**
 * Annotation delimiters that survived derivation: a generated product must not contain any. Every delimiter of the line is looked
 * for in every text file, not only in the extensions it is declared for, because an annotation written in a file type the engine
 * does not process for it comes out untouched (a `/*% ... %*\/` in a `.json`, where only `###< >###` is processed).
 */
export const checkLeftovers = ({
  productDir,
  config,
  exclude = []
}: {
  productDir: string
  config: LeftoverDelimiters
  /** Paths relative to `productDir` that are allowed to contain delimiters. */
  exclude?: readonly string[]
}): Leftover[] => {
  if (typeof productDir !== 'string' || productDir.trim() === '') {
    throw new InvalidArgumentError('"productDir" must be a non-empty path.')
  }
  const root = path.resolve(productDir)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new InvalidArgumentError(`"productDir" is not a directory: ${root}`)
  }

  const markers = [...new Set(config.delimiters.flatMap(({ start, end }) => [start, end]))]
    .filter((marker) => marker !== '')
  const skipped = new Set([...ALWAYS_SKIPPED, ...(config.ignore ?? [])])
  const excluded = new Set(exclude)

  const found: Leftover[] = []
  walk(root, skipped, (file) => {
    const relative = path.relative(root, file).split(path.sep).join('/')
    if (excluded.has(relative)) return
    const content = fs.readFileSync(file)
    if (isBinary(content)) return
    content.toString('utf8').split('\n').forEach((text, index) => {
      const delimiter = markers.find((marker) => text.includes(marker))
      if (delimiter !== undefined) found.push({ file: relative, line: index + 1, delimiter })
    })
  })
  return found.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
}
