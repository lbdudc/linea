import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import extract from 'extract-zip'
import { InvalidArgumentError } from '../errors.js'

export const extractArchive = async ({
  source,
  destDir,
  prefix
}: {
  source: string | Uint8Array
  destDir: string
  prefix?: string
}): Promise<{ dir: string }> => {
  if (typeof destDir !== 'string' || destDir.trim() === '') {
    throw new InvalidArgumentError('"destDir" must be a non-empty path.')
  }
  if (prefix !== undefined && typeof prefix !== 'string') {
    throw new InvalidArgumentError('"prefix" must be a string when provided.')
  }

  const target = path.resolve(destDir)
  fs.mkdirSync(target, { recursive: true })

  let archivePath: string
  let scratchDir: string | null = null
  if (typeof source === 'string') {
    if (source.trim() === '') {
      throw new InvalidArgumentError('"source" must be a non-empty path.')
    }
    archivePath = path.resolve(source)
    if (!fs.existsSync(archivePath)) {
      throw new InvalidArgumentError(`Archive not found: ${archivePath}`)
    }
  } else if (source instanceof Uint8Array) {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-core-archive-'))
    archivePath = path.join(scratchDir, 'archive.zip')
    fs.writeFileSync(archivePath, source)
  } else {
    throw new InvalidArgumentError('"source" must be a path or a Uint8Array.')
  }

  try {
    await extract(archivePath, { dir: target })
  } finally {
    if (scratchDir !== null) fs.rmSync(scratchDir, { recursive: true, force: true })
  }

  if (prefix === undefined) return { dir: target }

  const directories = fs
    .readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  const chosen = directories.find((name) => name.startsWith(prefix)) ?? directories[0]
  return { dir: chosen === undefined ? target : path.join(target, chosen) }
}
