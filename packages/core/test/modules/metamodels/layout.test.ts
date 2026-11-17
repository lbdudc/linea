import { describe, expect, it } from 'vitest'
import { createMemoryPackageSource, metamodelPath, readMetamodelFiles } from '../../../src/index.js'

const GRAMMAR = "grammar Basic\nentry Model: 'basic' name=ID?;\nterminal ID: /[a-z]+/;\nhidden terminal WS: /\\s+/;\n"
const open = async (files: Record<string, string>) => {
  const source = createMemoryPackageSource({ packages: { 'x:basic': { '1.0.0': files } } })
  return { files: await source.open({ location: 'x:basic', version: '1.0.0' }) }
}

describe('where the files of a metamodel are', () => {
  it('one folder per kind, each file named after its grammar', () => {
    expect(metamodelPath({ kind: 'grammar', grammar: 'datamodel' })).toBe('grammars/datamodel.langium')
    expect(metamodelPath({ kind: 'constraints', grammar: 'datamodel' })).toBe('constraints/datamodel.js')
    expect(metamodelPath({ kind: 'spec', grammar: 'datamodel' })).toBe('specs/datamodel.js')
    expect(metamodelPath({ kind: 'import', grammar: 'datamodel' })).toBe('imports/datamodel.js')
    expect(metamodelPath({ kind: 'scope', grammar: 'datamodel' })).toBe('scopes/datamodel.js')
    expect(metamodelPath({ kind: 'visualizations', grammar: 'datamodel' })).toBe('visualizations/datamodel.js')
    expect(metamodelPath({ kind: 'cases', grammar: 'datamodel' })).toBe('cases/datamodel.json')
  })

  it('reads a package laid out in folders', async () => {
    const pkg = await open({
      'metamodel.json': '{}',
      'grammars/basic.langium': GRAMMAR,
      'specs/basic.js': 'return 1',
      'visualizations/basic.js': 'return []',
      // not at the root and not a grammar: left alone
      'notes/other.langium': 'x'
    })
    expect(await readMetamodelFiles({ pkg })).toEqual([
      { grammar: 'basic', file: 'grammars/basic.langium', text: GRAMMAR, level: 0, scripts: { spec: 'return 1' }, visualizations: 'return []' }
    ])
  })

  it('does not read a package that has its files at the root', async () => {
    const pkg = await open({ 'metamodel.json': '{}', 'basic.langium': GRAMMAR, 'basic.constraints.js': 'return {}' })
    expect(await readMetamodelFiles({ pkg })).toEqual([])
  })
})
