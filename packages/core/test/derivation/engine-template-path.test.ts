import { describe, expect, it } from 'vitest'
import { namingFailedTemplates, type EngineWithInput } from '../../src/derivation/engine.js'

const engineOver = (files: string[]): EngineWithInput => ({
  input: {
    forEachCodeFile: (cb) => {
      for (const file of files) cb(file, 'content', true)
      return Promise.resolve()
    },
  },
})

describe('namingFailedTemplates', () => {
  it('adds the path of the template that failed to the error', () => {
    const engine = engineOver(['src\\a.js', 'src\\b.js'])
    namingFailedTemplates(engine)
    const run = () => engine.input!.forEachCodeFile!((file) => {
      if (file.endsWith('b.js')) throw new TypeError("Cannot read properties of undefined (reading 'sensors')")
    })
    expect(run).toThrow("Cannot read properties of undefined (reading 'sensors') (src/b.js)")
  })

  it('names an error once, and leaves values that are not errors as they are', () => {
    const engine = engineOver(['a.js'])
    namingFailedTemplates(engine)
    const shared = new Error('boom')
    expect(() => engine.input!.forEachCodeFile!(() => { throw shared })).toThrow('boom (a.js)')
    expect(() => engine.input!.forEachCodeFile!(() => { throw shared })).toThrow(/^boom \(a\.js\)$/)
    expect(() => engine.input!.forEachCodeFile!(() => { throw 'plain' })).toThrow('plain')
  })

  it('does nothing to an engine without input', () => {
    expect(() => namingFailedTemplates({})).not.toThrow()
  })
})
