import fs from 'node:fs'
import path from 'node:path'
import { PLATFORM_PATHS, PRODUCTS_INDEX_PATH } from '../constants.js'
import { InvalidArgumentError } from '../errors.js'

export interface LinePaths {
  readonly platform: string
  readonly code: string
  readonly model: string
  readonly config: string
  readonly extraJs: string
  readonly transformation: string
  readonly productsIndex: string
}

const assertPath = (value: unknown, parameter: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidArgumentError(`"${parameter}" must be a non-empty path.`)
  }
  return path.resolve(value)
}

export const resolveLinePaths = ({ lineDir }: { lineDir: string }): LinePaths => {
  const root = assertPath(lineDir, 'lineDir')
  return {
    platform: path.join(root, PLATFORM_PATHS.root),
    code: path.join(root, PLATFORM_PATHS.code),
    model: path.join(root, PLATFORM_PATHS.model),
    config: path.join(root, PLATFORM_PATHS.config),
    extraJs: path.join(root, PLATFORM_PATHS.extraJs),
    transformation: path.join(root, PLATFORM_PATHS.transformation),
    productsIndex: path.join(root, PRODUCTS_INDEX_PATH)
  }
}

export const ensureDir = ({ dirPath }: { dirPath: string }): string => {
  const absolute = assertPath(dirPath, 'dirPath')
  fs.mkdirSync(absolute, { recursive: true })
  return absolute
}

export const readTextFile = ({ filePath }: { filePath: string }): string =>
  fs.readFileSync(assertPath(filePath, 'filePath'), 'utf8')

export const writeTextFile = ({
  filePath,
  content
}: {
  filePath: string
  content: string
}): string => {
  const absolute = assertPath(filePath, 'filePath')
  if (typeof content !== 'string') {
    throw new InvalidArgumentError('"content" must be a string.')
  }
  ensureDir({ dirPath: path.dirname(absolute) })
  fs.writeFileSync(absolute, content, 'utf8')
  return absolute
}

export const fileExists = ({ filePath }: { filePath: string }): boolean => {
  const absolute = assertPath(filePath, 'filePath')
  try {
    return fs.statSync(absolute).isFile()
  } catch {
    return false
  }
}
