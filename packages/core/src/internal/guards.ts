
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isArray = (value: unknown): value is readonly unknown[] => Array.isArray(value)
