import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { InvalidArgumentError } from '../errors.js'

export interface FileChange {
  readonly action: 'create' | 'update' | 'delete'
  readonly file_path: string
  readonly content?: string
  readonly encoding?: 'text' | 'base64'
}

const NEVER_DELETED = new Set(['README.md'])

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tif', '.tiff', '.avif',
  '.svgz',
  '.pdf', '.zip', '.gz', '.tar', '.tgz', '.bz2', '.7z', '.rar', '.jar', '.war',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.avi', '.mov', '.webm', '.ogg', '.wav', '.flac',
  '.so', '.dll', '.dylib', '.exe', '.class', '.pyc', '.wasm', '.node',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods',
  '.db', '.sqlite', '.keystore', '.jks', '.p12', '.pfx',
  '.bin', '.dat'
])

const isBinaryPath = (filePath: string): boolean =>
  BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())

const toRepositoryPath = (baseDir: string, filePath: string): string =>
  path.relative(baseDir, filePath).split(path.sep).join('/')

const md5 = (filePath: string): string => {
  const hash = crypto.createHash('md5')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

const hasSameContent = (a: string, b: string): boolean => md5(a) === md5(b)

const readAsChange = (
  action: 'create' | 'update',
  baseDir: string,
  absolutePath: string
): FileChange => {
  const binary = isBinaryPath(absolutePath)
  return {
    action,
    file_path: toRepositoryPath(baseDir, absolutePath),
    content: fs.readFileSync(absolutePath, binary ? 'base64' : 'utf-8'),
    encoding: binary ? 'base64' : 'text'
  }
}

const JVM_BUILD_FILES = new Set(['build.gradle', 'build.gradle.kts', 'pom.xml'])

const isBuildOutput = (name: string, siblings: fs.Dirent[]): boolean =>
  name === '.gradle' || (name === 'bin' && siblings.some((sibling) => sibling.isFile() && JVM_BUILD_FILES.has(sibling.name)))

const listFiles = (dir: string): string[] => {
  const found: string[] = []
  const walk = (current: string, prefix: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        if (isBuildOutput(entry.name, entries)) continue
        walk(path.join(current, entry.name), relative)
      } else if (entry.isFile()) {
        found.push(relative)
      }
    }
  }
  walk(dir, '')
  return found.sort()
}

const assertDir = (value: unknown, parameter: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidArgumentError(`"${parameter}" must be a non-empty path.`)
  }
  return path.resolve(value)
}

export const diffDirectories = ({
  oldDir,
  newDir
}: {
  oldDir: string
  newDir: string
}): FileChange[] => {
  const oldRoot = assertDir(oldDir, 'oldDir')
  const newRoot = assertDir(newDir, 'newDir')

  const oldFiles = new Set(listFiles(oldRoot))
  const newFiles = listFiles(newRoot)
  const changes: FileChange[] = []

  for (const relative of newFiles) {
    const newPath = path.join(newRoot, ...relative.split('/'))
    if (!oldFiles.has(relative)) {
      changes.push(readAsChange('create', newRoot, newPath))
      continue
    }
    const oldPath = path.join(oldRoot, ...relative.split('/'))
    if (!hasSameContent(oldPath, newPath)) {
      changes.push(readAsChange('update', newRoot, newPath))
    }
  }

  const newFileSet = new Set(newFiles)
  for (const relative of oldFiles) {
    if (newFileSet.has(relative)) continue
    if (NEVER_DELETED.has(path.posix.basename(relative))) continue
    changes.push({ action: 'delete', file_path: relative })
  }

  return changes.sort((a, b) => (a.file_path < b.file_path ? -1 : a.file_path > b.file_path ? 1 : 0))
}
