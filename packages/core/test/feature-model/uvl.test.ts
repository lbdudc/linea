import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { featuresOf, parseUvl, printUvl, UvlParseError, uvlName, type FeatureModelTree, type FeatureNode } from '../../src/index.js'

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/models')
const read = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), 'utf8')

const leaf = (name: string, extra: Partial<FeatureNode> = {}): FeatureNode => ({ name, groups: [], ...extra })
const PHONES: FeatureModelTree = {
  name: 'Phones',
  root: {
    name: 'Phones',
    groups: [
      { kind: 'mandatory', features: [{ name: 'Screen', groups: [{ kind: 'alternative', features: [leaf('Lcd'), leaf('Oled')] }] }, leaf('Battery')] },
      { kind: 'optional', features: [{ name: 'Camera', groups: [{ kind: 'or', features: [leaf('Front'), leaf('Rear')] }] }, leaf('Gps'), leaf('Extras', { abstract: true })] }
    ]
  },
  constraints: [
    { operator: '=>', left: { feature: 'Gps' }, right: { feature: 'Oled' } },
    { not: { operator: '&', left: { feature: 'Front' }, right: { feature: 'Gps' } } }
  ]
}

describe('printUvl', () => {
  it('writes the feature model the way UVL writes it', () => {
    expect(printUvl({ tree: PHONES })).toBe([
      'features', '\tPhones', '\t\tmandatory', '\t\t\tScreen', '\t\t\t\talternative', '\t\t\t\t\tLcd', '\t\t\t\t\tOled', '\t\t\tBattery',
      '\t\toptional', '\t\t\tCamera', '\t\t\t\tor', '\t\t\t\t\tFront', '\t\t\t\t\tRear', '\t\t\tGps', '\t\t\tExtras {abstract}',
      '', 'constraints', '\tGps => Oled', '\t!(Front & Gps)', ''
    ].join('\n'))
  })

  it('quotes the names UVL does not write plain, and leaves empty groups out', () => {
    const tree: FeatureModelTree = {
      name: 'M',
      root: { name: 'M', groups: [{ kind: 'optional', features: [] }, { kind: 'mandatory', features: [leaf('Dual sim'), leaf('Web-App'), leaf('or'), leaf('_x'), leaf('Étoile')] }] },
      constraints: []
    }
    const text = printUvl({ tree })
    expect(text).toContain('"Dual sim"')
    expect(text).toContain('"Web-App"')
    expect(text).toContain('"or"')
    expect(text).toContain('"_x"')
    expect(text).not.toContain('optional')
    expect(parseUvl({ content: text }).root.groups[0]!.features.map((f) => f.name)).toEqual(['Dual sim', 'Web-App', 'or', '_x', 'Étoile'])
  })

  it('names with a dot, a quote or a line break cannot be written: they are made safe', () => {
    expect(uvlName({ name: 'a.b' })).toBe('"a_b"')
    expect(uvlName({ name: 'plain' })).toBe('plain')
  })
})

describe('parseUvl', () => {
  it('reads back what it prints', () => {
    expect(parseUvl({ content: printUvl({ tree: PHONES }) })).toEqual(PHONES)
  })

  it('groups all the operators to the left, as the UVL grammar does, and & before | before => before <=>', () => {
    const constraint = (c: string) => parseUvl({ content: `features\n\tR\n\t\toptional\n\t\t\tA\n\t\t\tB\n\t\t\tC\nconstraints\n\t${c}\n` }).constraints[0]
    const [a, b, c] = [{ feature: 'A' }, { feature: 'B' }, { feature: 'C' }]
    expect(constraint('A => B => C')).toEqual({ operator: '=>', left: { operator: '=>', left: a, right: b }, right: c })
    expect(constraint('A | B & C')).toEqual({ operator: '|', left: a, right: { operator: '&', left: b, right: c } })
    expect(constraint('A <=> B => C')).toEqual({ operator: '<=>', left: a, right: { operator: '=>', left: b, right: c } })
    expect(constraint('!A & B')).toEqual({ operator: '&', left: { not: a }, right: b })
  })

  it('reads group cardinalities', () => {
    const text = 'features\n\tM\n\t\t[1..2]\n\t\t\tA\n\t\t\tB\n\t\t[1..*]\n\t\t\tC\n\t\t\tD\n\t\t[2]\n\t\t\tE\n\t\t\tF\n'
    const tree = parseUvl({ content: text })
    expect(tree.root.groups.map((g) => [g.kind, g.min, g.max])).toEqual([['cardinality', 1, 2], ['cardinality', 1, undefined], ['cardinality', 2, 2]])
    expect(printUvl({ tree })).toBe(text)
  })

  it('skips comments, the namespace and the imports', () => {
    const tree = parseUvl({ content: 'namespace Phones\n// a comment\ninclude\n\tBoolean\nimports\n\tOther as o\n/* a\nblock */\nfeatures\n\tPhones // the root\n\t\toptional\n\t\t\tGps\n' })
    expect(tree.name).toBe('Phones')
    expect(tree.root.groups[0]!.features.map((f) => f.name)).toEqual(['Gps'])
  })

  it('reads names that start with an underscore, as models published on UVLHub have', () => {
    const tree = parseUvl({ content: 'namespace __Root__\n\nfeatures\n\t__Root__ {abstract}\t\n\t\toptional\n\t\t\t_POSIX_THREADS\n' })
    expect(tree.root).toMatchObject({ name: '__Root__', abstract: true })
  })

  it.each([
    ['typed features', 'features\n\tR\n\t\toptional\n\t\t\tInteger A\n', /line 4: typed features \(Integer\)/],
    ['feature cardinalities', 'features\n\tR\n\t\toptional\n\t\t\tA cardinality [1..2]\n', /feature cardinalities/],
    ['an unknown group', 'features\n\tR\n\t\tmaybe\n\t\t\tA\n', /expected mandatory, optional/],
    ['arithmetic constraints', 'features\n\tR\n\t\toptional\n\t\t\tA\nconstraints\n\tA > 1\n', /unexpected '>'/],
    ['two roots', 'features\n\tR\n\tS\n', /one root feature/],
    ['a group without features', 'features\n\tR\n\t\toptional\n', /needs its features/],
    ['a missing parenthesis', 'features\n\tR\n\t\toptional\n\t\t\tA\nconstraints\n\t(A\n', /not closed/],
    ['no features section', 'constraints\n', /no 'features' section/]
  ])('says what is wrong with %s', (_what, content, message) => {
    expect(() => parseUvl({ content })).toThrow(message)
    expect(() => parseUvl({ content })).toThrow(UvlParseError)
  })

  it.each(['simple.uvl', 'gema.uvl'])('reads the model %s and prints it back the same', (name) => {
    const tree = parseUvl({ content: read(name) })
    expect(featuresOf({ tree }).length).toBeGreaterThan(1)
    expect(parseUvl({ content: printUvl({ tree }) })).toEqual(tree)
  })
})
