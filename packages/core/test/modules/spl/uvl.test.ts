import { describe, expect, it } from 'vitest'
import { featureNameOfLine, featureNamesOfSections, graftModules, parseUvlSections } from '../../../src/modules/spl/feature-model.js'

describe('parseUvlSections', () => {
  it('splits preamble, features and constraints', () => {
    const sections = parseUvlSections({ content: 'namespace x\nfeatures\n\tRoot\n\t\toptional\n\t\t\tA\nconstraints\n\tA => Root\n' })
    expect(sections.preamble).toEqual(['namespace x'])
    expect(sections.features.map((l) => [l.level, l.text])).toEqual([[1, 'Root'], [2, 'optional'], [3, 'A']])
    expect(sections.constraints.map((l) => l.text)).toEqual(['A => Root'])
  })

  it('reads space indentation and CRLF', () => {
    const sections = parseUvlSections({ content: 'features\r\n    Root\r\n        mandatory\r\n            A\r\n' })
    expect(sections.features.map((l) => l.level)).toEqual([1, 2, 3])
  })

  it('ignores sections it does not know and blank lines', () => {
    const sections = parseUvlSections({ content: 'features\n\n\tRoot\ninclude\n\tx\nconstraints\n\tC\n' })
    expect(sections.features.map((l) => l.text)).toEqual(['Root'])
    expect(sections.constraints.map((l) => l.text)).toEqual(['C'])
  })

  it('copes with a file that has no indentation at all', () => {
    expect(parseUvlSections({ content: 'features\n' }).features).toEqual([])
  })
})

describe('featureNameOfLine / featureNamesOfSections', () => {
  it.each([
    ['Root', 'Root'],
    ['Child {abstract}', 'Child'],
    ['"Quoted name"', 'Quoted name'],
    ['mandatory', undefined],
    ['or', undefined],
    ['[1..2]', undefined],
    ['{attr 1}', undefined],
    ['9lives', undefined]
  ])('%s -> %s', (text, expected) => {
    expect(featureNameOfLine({ text })).toBe(expected)
  })

  it('collects the features of a section', () => {
    const { features } = parseUvlSections({ content: 'features\n\tRoot\n\t\tor\n\t\t\tA\n\t\t\tB\n' })
    expect(featureNamesOfSections({ features })).toEqual(['Root', 'A', 'B'])
  })
})

describe('graftModules', () => {
  const spl = (content: string) => parseUvlSections({ content })

  it('adds a mandatory group when the root has none', () => {
    expect(graftModules({ spl: spl('features\n\tRoot\n'), modules: [spl('features\n\tM\n\t\toptional\n\t\t\tX\n')] }))
      .toBe('features\n\tRoot\n\t\tmandatory\n\t\t\tM\n\t\t\t\toptional\n\t\t\t\t\tX\n')
  })

  it('extends the mandatory group the root already has', () => {
    const out = graftModules({
      spl: spl('features\n\tRoot\n\t\tmandatory\n\t\t\tOwn\n\t\t\t\toptional\n\t\t\t\t\tDeep\n\t\toptional\n\t\t\tOpt\n'),
      modules: [spl('features\n\tM\n')]
    })
    expect(out).toBe('features\n\tRoot\n\t\tmandatory\n\t\t\tOwn\n\t\t\t\toptional\n\t\t\t\t\tDeep\n\t\t\tM\n\t\toptional\n\t\t\tOpt\n')
  })

  it('keeps the preamble and joins the constraints', () => {
    const out = graftModules({
      spl: spl('namespace s\nfeatures\n\tRoot\nconstraints\n\tRoot\n'),
      modules: [spl('features\n\tM\nconstraints\n\tM => Root\n')]
    })
    expect(out).toBe('namespace s\nfeatures\n\tRoot\n\t\tmandatory\n\t\t\tM\nconstraints\n\tRoot\n\tM => Root\n')
  })

  it('stops at the end of the root when the next root starts', () => {
    const out = graftModules({ spl: spl('features\n\tRoot\n\tOther\n\t\tmandatory\n\t\t\tZ\n'), modules: [spl('features\n\tM\n')] })
    expect(out.startsWith('features\n\tRoot\n\t\tmandatory\n\t\t\tM\n\tOther')).toBe(true)
  })

  it('does not touch an SPL without modules', () => {
    expect(graftModules({ spl: spl('features\n\tRoot\n'), modules: [] })).toBe('features\n\tRoot\n')
  })

  it('needs a root feature', () => {
    expect(() => graftModules({ spl: spl('features\n'), modules: [] })).toThrow(/no root feature/)
  })
})
