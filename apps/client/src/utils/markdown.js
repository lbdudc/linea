import DOMPurify from 'dompurify'

// A small markdown for the text people write on a git host (issues, comments): headings, lists, quotes, code, bold, italic, links.
// The text is escaped first and the result is sanitised after, so nothing a person writes can bring markup of its own.
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const inline = (text) => escape(text)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

export const renderMarkdown = (source) => {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let paragraph = []
  let list = null
  const flushParagraph = () => { if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`); paragraph = [] }
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${list.tag}>`); list = null }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^```/.test(line)) {
      flushParagraph(); flushList()
      const code = []
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i])
      out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`)
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    const quote = line.match(/^>\s?(.*)$/)
    if (heading) { flushParagraph(); flushList(); out.push(`<h${heading[1].length + 2}>${inline(heading[2])}</h${heading[1].length + 2}>`) }
    else if (bullet || numbered) {
      flushParagraph()
      const tag = bullet ? 'ul' : 'ol'
      if (list && list.tag !== tag) flushList()
      list ??= { tag, items: [] }
      list.items.push((bullet ?? numbered)[1])
    }
    else if (quote) { flushParagraph(); flushList(); out.push(`<blockquote>${inline(quote[1])}</blockquote>`) }
    else if (line.trim() === '') { flushParagraph(); flushList() }
    else { flushList(); paragraph.push(line) }
  }
  flushParagraph(); flushList()
  return DOMPurify.sanitize(out.join(''), { ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'blockquote', 'h3', 'h4', 'h5', 'h6'], ALLOWED_ATTR: ['href', 'target', 'rel'] })
}
