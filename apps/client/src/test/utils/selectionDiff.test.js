import { describe, expect, it } from 'vitest'
import { selectionDiff } from 'src/utils/selectionDiff'

describe('selectionDiff', () => {
  it('lists what a product gains and loses when its selection becomes another', () => {
    expect(selectionDiff(['A', 'B', 'C'], ['B', 'C', 'D', 'E'])).toEqual({ added: ['D', 'E'], removed: ['A'], same: false })
  })

  it('says when nothing changes, whatever the order', () => {
    expect(selectionDiff(['B', 'A'], ['A', 'B']).same).toBe(true)
    expect(selectionDiff(undefined, []).same).toBe(true)
  })
})
