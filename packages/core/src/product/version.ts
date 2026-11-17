import { VERSION_PATTERN } from '../constants.js'
import { InvalidArgumentError } from '../errors.js'

export const incrementVersion = ({
  version,
  index
}: {
  version: string
  index: number
}): string => {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new InvalidArgumentError(
      `"version" must match x.y.z, got ${JSON.stringify(version)}.`
    )
  }
  if (!Number.isInteger(index) || index < 0 || index > 2) {
    throw new InvalidArgumentError(`"index" must be an integer in [0, 2], got ${String(index)}.`)
  }

  const parts = version.split('.').map(Number)
  return parts
    .map((part, i) => {
      if (i === index) return part + 1
      if (i > index) return 0
      return part
    })
    .join('.')
}
