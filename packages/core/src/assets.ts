import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { InvalidArgumentError } from './errors.js'

export const assetsRoot = (): string => path.dirname(fileURLToPath(import.meta.url))

export const resolveAsset = ({ segments }: { segments: string[] }): string => {
  if (!Array.isArray(segments) || segments.some((segment) => typeof segment !== 'string')) {
    throw new InvalidArgumentError('"segments" must be an array of strings.')
  }
  return path.join(assetsRoot(), ...segments)
}
