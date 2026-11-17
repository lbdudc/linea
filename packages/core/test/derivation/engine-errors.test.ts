import { describe, expect, it } from 'vitest'
import { rethrowDerivationError } from '../../src/derivation/engine.js'
import { LinePlatformNotFoundError, TemplateError } from '../../src/index.js'

describe('rethrowDerivationError', () => {
  it('reports a template exception as a TemplateError with its message, not as a missing platform', () => {
    const cause = new TypeError("Cannot read properties of undefined (reading 'sensors')")
    let thrown: unknown
    try { rethrowDerivationError(cause, 'generate') } catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(TemplateError)
    expect(thrown).not.toBeInstanceOf(LinePlatformNotFoundError)
    expect((thrown as TemplateError).code).toBe('TEMPLATE_ERROR')
    expect((thrown as TemplateError).message).toContain('reading \'sensors\'')
    expect((thrown as TemplateError).cause).toBe(cause)
  })

  it('keeps a real missing platform as LinePlatformNotFoundError', () => {
    const missing = new LinePlatformNotFoundError('No annotated code')
    expect(() => rethrowDerivationError(missing)).toThrow(missing)
  })
})

describe('rethrowDerivationError at setup', () => {
  it('keeps a failure of the platform files as LinePlatformNotFoundError', () => {
    expect(() => rethrowDerivationError(new SyntaxError('Unexpected token'))).toThrow(LinePlatformNotFoundError)
  })
})
