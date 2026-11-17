import { describe, expect, it } from 'vitest'
import { selectProducts } from '../../src/ci/select.js'

const products = [
  { name: 'big', features: ['Core', 'Banner', 'Logger'] },
  { name: 'small', features: ['Core'] },
  { name: 'logs', features: ['Core', 'Logger'] }
]
const featuresByFile = {
  'Banner.vue': { Banner: 2 },
  'Log.java': { Logger: 1, Banner: 1 },
  'Plain.java': {}
}
const P = 'src/platform/code/'

describe('selectProducts', () => {
  it('selects the products that have a touched feature, most overlap first', () => {
    const result = selectProducts({ changedFiles: [`${P}Log.java`], featuresByFile, products })
    expect(result.selected).toEqual(['big', 'logs'])
    expect(result.touchedFeatures).toEqual(['Banner', 'Logger'])
    expect(result.all).toBe(false)
  })

  it('adds the smallest products as a baseline and honours max', () => {
    expect(selectProducts({ changedFiles: [`${P}Banner.vue`], featuresByFile, products, baseline: 2 }).selected).toEqual(['big', 'small'])
    expect(selectProducts({ changedFiles: [`${P}Log.java`], featuresByFile, products, max: 1 }).selected).toEqual(['big'])
  })

  it('selects everything for platform files, featureless code and unknown files', () => {
    for (const file of ['src/platform/model.uvl', 'spl.json', `${P}Plain.java`, `${P}Gone.java`]) {
      const result = selectProducts({ changedFiles: [file], featuresByFile, products })
      expect(result.all, file).toBe(true)
      expect(result.selected).toHaveLength(3)
    }
  })

  it('selects nothing for a change to docs only', () => {
    const result = selectProducts({ changedFiles: ['README.md', 'docs/a.md'], featuresByFile, products })
    expect(result).toMatchObject({ selected: [], all: false })
  })
})
