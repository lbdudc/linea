import { describe, it, expect } from 'vitest'
import { parsePatch, splitRows } from 'src/utils/diffPatch'
import { highlight, languageOf } from 'src/utils/highlight'

const PATCH = ['@@ -1,4 +1,5 @@', ' keep', '-old one', '-old two', '+new one', '+new two', '+new three', ' tail'].join('\n')

describe('parsePatch', () => {
  it('numbers the lines of both versions and says which were added, removed or kept', () => {
    const rows = parsePatch(PATCH)
    expect(rows[0]).toEqual({ type: 'hunk', text: '@@ -1,4 +1,5 @@' })
    expect(rows[1]).toEqual({ type: 'ctx', oldLine: 1, newLine: 1, text: 'keep' })
    expect(rows[2]).toEqual({ type: 'del', oldLine: 2, text: 'old one' })
    expect(rows[4]).toEqual({ type: 'add', newLine: 2, text: 'new one' })
    expect(rows.at(-1)).toEqual({ type: 'ctx', oldLine: 4, newLine: 5, text: 'tail' })
  })

  it('starts again at each hunk, ignores the note about a missing line break, and is empty for no patch', () => {
    const rows = parsePatch('@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n@@ -10 +10 @@\n-c\n+d')
    expect(rows.filter((row) => row.type !== 'hunk').map((row) => [row.type, row.oldLine ?? row.newLine])).toEqual([['del', 1], ['add', 1], ['del', 10], ['add', 10]])
    expect(parsePatch('')).toEqual([])
    expect(parsePatch(undefined)).toEqual([])
  })
})

describe('splitRows', () => {
  it('puts the removed lines next to the added ones that follow, and a kept line on both sides', () => {
    const rows = splitRows(parsePatch(PATCH))
    expect(rows[1].left.text).toBe('keep')
    expect(rows[1].right.text).toBe('keep')
    expect(rows[2]).toMatchObject({ left: { text: 'old one' }, right: { text: 'new one' } })
    expect(rows[3]).toMatchObject({ left: { text: 'old two' }, right: { text: 'new two' } })
    expect(rows[4]).toMatchObject({ left: null, right: { text: 'new three' } })
  })
})

describe('highlight', () => {
  it('marks keywords, strings, numbers and comments of the language of the file', () => {
    const html = highlight("const a = 'x' + 12 // note", 'src/a.js')
    expect(html).toContain('<span class="hl-kw">const</span>')
    expect(html).toContain('<span class="hl-str">\'x\'</span>')
    expect(html).toContain('<span class="hl-num">12</span>')
    expect(html).toContain('<span class="hl-com">// note</span>')
  })

  it('leaves what it does not know as escaped text, and never lets markup through', () => {
    expect(languageOf('README.md')).toBeNull()
    expect(highlight('<b>x</b> & y', 'README.md')).toBe('&lt;b&gt;x&lt;/b&gt; &amp; y')
    expect(highlight('<script>alert(1)</script>', 'a.js')).not.toContain('<script>')
  })

  it('uses the hash for comments in python and yaml', () => {
    expect(highlight('x = 1  # one', 'a.py')).toContain('<span class="hl-com"># one</span>')
    expect(highlight('key: value # c', 'a.yml')).toContain('hl-com')
  })
})
