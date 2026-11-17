import { describe, it, expect } from 'vitest'
import { toCsv } from 'src/utils/csv'

describe('toCsv', () => {
  it('writes a header and one line per row', () => {
    expect(toCsv([{ name: 'a', version: '1.0.0' }, { name: 'b', version: '2.0.0' }])).toBe('name,version\r\na,1.0.0\r\nb,2.0.0')
  })

  it('quotes what has commas, quotes or line breaks, and leaves empty values empty', () => {
    expect(toCsv([{ name: 'a,b', note: 'say "hi"', empty: null }])).toBe('name,note,empty\r\n"a,b","say ""hi""",')
  })

  it('is empty without rows', () => {
    expect(toCsv([])).toBe('')
  })
})
