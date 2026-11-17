import { describe, expect, it } from 'vitest'
import { bangoName, defaultSelection, parseUvl, rootFeatureName, selectionText } from '../../../src/index.js'

describe('selectionText', () => {
  it('writes a selection as a model of the feature metamodel, with names the metamodel can read', () => {
    expect(selectionText({ model: 'Phones', features: ['Oled', 'Dual sim', 'select'] })).toBe('selection of Phones {\n  select Oled\n  select "Dual sim"\n  select "select"\n}\n')
    expect(selectionText({ model: 'Phones', features: [] })).toBe('selection of Phones {\n}\n')
  })

  it('quotes a name that is a word of the metamodel or does not start like a name', () => {
    expect(bangoName({ name: 'Gps' })).toBe('Gps')
    expect(bangoName({ name: 'or' })).toBe('"or"')
    expect(bangoName({ name: '2fast' })).toBe('"2fast"')
  })

  it('names the root feature of an SPL after it', () => {
    expect(rootFeatureName({ name: 'QA-Mono.2' })).toBe('QAMono2')
    expect(rootFeatureName({ name: '---' })).toBe('Spl')
  })
})

describe('defaultSelection', () => {
  const tree = parseUvl({ content: [
    'features', '\tPhones',
    '\t\tmandatory', '\t\t\tScreen', '\t\t\t\talternative', '\t\t\t\t\tLcd', '\t\t\t\t\tOled', '\t\t\tBattery',
    '\t\toptional', '\t\t\tCamera', '\t\t\t\tor', '\t\t\t\t\tFront', '\t\t\t\t\tRear', '\t\t\tGps',
    '\t\t[2..3]', '\t\t\tA', '\t\t\tB', '\t\t\tC', ''
  ].join('\n') })

  it('is what is mandatory, the first of each alternative, or and cardinality group that is in, and nothing optional', () => {
    expect(defaultSelection({ tree })).toEqual(['Screen', 'Lcd', 'Battery', 'A', 'B'])
  })

  it('does not list the root: every selection has it', () => {
    expect(defaultSelection({ tree: parseUvl({ content: 'features\n\tR\n' }) })).toEqual([])
  })
})
