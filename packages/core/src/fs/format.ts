import fs from 'node:fs'
import path from 'node:path'
import * as prettier from 'prettier'
import { InvalidArgumentError } from '../errors.js'

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'coverage'])

const listFiles = (dir: string): string[] => {
  const found: string[] = []
  const walk = (current: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        walk(absolute)
      } else if (entry.isFile()) {
        found.push(absolute)
      }
    }
  }
  walk(dir)
  return found.sort()
}

export const formatDirectory = async ({ dir }: { dir: string }): Promise<{ formatted: number }> => {
  if (typeof dir !== 'string' || dir.trim() === '') {
    throw new InvalidArgumentError('"dir" must be a non-empty path.')
  }
  const root = path.resolve(dir)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new InvalidArgumentError(`Not a directory: ${root}`)
  }

  let formatted = 0
  for (const filePath of listFiles(root)) {
    try {
      const { inferredParser } = await prettier.getFileInfo(filePath, { resolveConfig: false })
      if (inferredParser === null) continue

      const options = await prettier.resolveConfig(filePath)
      const original = fs.readFileSync(filePath, 'utf8')
      const output = await prettier.format(original, { ...options, filepath: filePath })
      if (output !== original) {
        fs.writeFileSync(filePath, output, 'utf8')
        formatted += 1
      }
    } catch {
      continue
    }
  }

  return { formatted }
}
