import { describe, it, expect } from 'vitest'
import { renderMarkdown } from 'src/utils/markdown'

describe('renderMarkdown', () => {
  it('writes paragraphs, bold, italic, code and links', () => {
    const html = renderMarkdown('Hello **bold** and *soft* with `code`\nsame paragraph\n\n[docs](https://example.org/a)')
    expect(html).toContain('<p>Hello <strong>bold</strong> and <em>soft</em> with <code>code</code><br>same paragraph</p>')
    expect(html).toContain('<a href="https://example.org/a" target="_blank" rel="noopener noreferrer">docs</a>')
  })

  it('writes headings, lists, quotes and fenced code', () => {
    const html = renderMarkdown('# Steps\n1. Click\n2. Wait\n\n- one\n- two\n\n> said\n\n```\n<b>x</b>\n```')
    expect(html).toContain('<h3>Steps</h3>')
    expect(html).toContain('<ol><li>Click</li><li>Wait</li></ol>')
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>')
    expect(html).toContain('<blockquote>said</blockquote>')
    expect(html).toContain('<pre><code>&lt;b&gt;x&lt;/b&gt;\n</code></pre>'.replace('\n</code>', '</code>'))
  })

  it('brings no markup of its own: tags are shown as text and only web links are links', () => {
    const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1))')
    const dom = new DOMParser().parseFromString(html, 'text/html')
    expect(dom.querySelector('script, img, [onerror], a')).toBeNull()
    expect(dom.body.textContent).toContain('<script>alert(1)</script>')
  })

  it('is empty for nothing', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown(undefined)).toBe('')
  })
})
