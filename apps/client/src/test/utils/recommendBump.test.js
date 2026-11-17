import { describe, it, expect } from 'vitest'
import { recommendBump } from 'src/utils/recommendBump'

const spec = (features, extra = {}) => ({ basicData: { name: 'p', version: '1.0.0', ...extra }, features })

describe('recommendBump', () => {
  it('says nothing without a generation to compare with, or without changes', () => {
    expect(recommendBump(null, spec(['A']))).toBeNull()
    expect(recommendBump(spec(['A']), spec(['A']))).toBeNull()
  })

  it('recommends minor for a new feature and major for a removed one', () => {
    expect(recommendBump(spec(['A']), spec(['A', 'B']))).toEqual({ bump: 'minor', reason: 'features_added', n: 1 })
    expect(recommendBump(spec(['A', 'B']), spec(['A']))).toEqual({ bump: 'major', reason: 'features_removed', n: 1 })
  })

  it('a removed feature wins over an added one', () => {
    expect(recommendBump(spec(['A', 'B']), spec(['A', 'C'])).bump).toBe('major')
  })

  it('recommends patch for any other change', () => {
    expect(recommendBump(spec(['A']), spec(['A'], { description: 'x' }))).toMatchObject({ bump: 'patch', reason: 'other' })
  })
})
