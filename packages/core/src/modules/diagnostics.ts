import type { Diagnostic } from './types.js'

export const hasErrors = (diagnostics: readonly Diagnostic[]): boolean => diagnostics.some(({ severity }) => severity === 'error')
