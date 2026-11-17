import { describe, it, expect } from 'vitest'
import { relativeDays, relativeShort } from 'src/utils/relativeTime'

const ago = (ms) => new Date(Date.now() - ms).toISOString()
const DAY = 86400000

describe('relativeDays', () => {
  it('counts days up to a month, then months, then years', () => {
    expect(relativeDays(ago(3 * DAY), 'en')).toBe('3 days ago')
    expect(relativeDays(ago(60 * DAY), 'en')).toBe('2 months ago')
    expect(relativeDays(ago(800 * DAY), 'en')).toBe('2 years ago')
  })

  it('says today for the current day', () => {
    expect(relativeDays(ago(1000), 'en')).toBe('today')
  })
})

describe('relativeShort', () => {
  it('uses the coarsest unit that fits, in the past and the future', () => {
    expect(relativeShort(ago(2 * 3600 * 1000), 'en')).toMatch(/2 hr\. ago/)
    expect(relativeShort(new Date(Date.now() + 5 * 60 * 1000 + 500).toISOString(), 'en')).toMatch(/in 5 min\./)
  })
})
