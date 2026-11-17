// A light syntax highlighter for one line of code: comments, strings, numbers and the keywords of the language of the file. It does
// not parse (a diff shows lines, not whole files): a block comment that began above is not known. The result is safe HTML.

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const KEYWORDS = {
  js: 'const let var function return if else for while do switch case break continue new this class extends import export from default async await try catch finally throw typeof instanceof in of null undefined true false void delete yield static get set',
  java: 'public private protected static final class interface extends implements import package return if else for while do switch case break continue new this super try catch finally throw throws void int long double float boolean char byte short null true false abstract enum instanceof synchronized',
  py: 'def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda None True False yield global async await',
  sh: 'if then else elif fi for while do done case esac function return in export echo exit',
  yaml: 'true false null yes no',
  uvl: 'features constraints include imports namespace mandatory optional or alternative cardinality',
  css: 'important',
  html: '',
}
const FAMILY = {
  js: 'js', jsx: 'js', ts: 'js', tsx: 'js', mjs: 'js', cjs: 'js', vue: 'js', json: 'js', gradle: 'java', groovy: 'java', kt: 'java', scala: 'java',
  java: 'java', c: 'java', h: 'java', cpp: 'java', cs: 'java', go: 'java', rs: 'java', py: 'py', rb: 'py', sh: 'sh', bash: 'sh', yml: 'yaml', yaml: 'yaml',
  uvl: 'uvl', css: 'css', scss: 'css', html: 'html', xml: 'html', properties: 'yaml', toml: 'yaml',
}
const HASH_COMMENTS = new Set(['py', 'sh', 'yaml'])
const NONE = new Set(['md', 'txt', 'lock', 'svg', 'csv'])

export const languageOf = (path) => {
  const ext = String(path ?? '').split('.').pop().toLowerCase()
  return NONE.has(ext) ? null : (FAMILY[ext] ?? null)
}

const sets = new Map()
const keywordsOf = (language) => {
  if (!sets.has(language)) sets.set(language, new Set((KEYWORDS[language] ?? '').split(' ').filter(Boolean)))
  return sets.get(language)
}

/** The line as HTML: `<span class="hl-…">` around what is a comment, a string, a number or a keyword. Plain, escaped, for a language it does not know. */
export const highlight = (text, path) => {
  const language = languageOf(path)
  if (!language) return escape(text)
  const keywords = keywordsOf(language)
  const comment = HASH_COMMENTS.has(language) ? '#.*' : '\\/\\/.*|\\/\\*.*?\\*\\/'
  const token = new RegExp(`(${comment})|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|\\b(\\d+(?:\\.\\d+)?)\\b|\\b([A-Za-z_][A-Za-z0-9_]*)\\b`, 'g')
  let out = ''
  let last = 0
  for (const match of text.matchAll(token)) {
    out += escape(text.slice(last, match.index))
    const [all, commentText, stringText, numberText, word] = match
    if (commentText) out += `<span class="hl-com">${escape(all)}</span>`
    else if (stringText) out += `<span class="hl-str">${escape(all)}</span>`
    else if (numberText) out += `<span class="hl-num">${escape(all)}</span>`
    else if (word && keywords.has(word)) out += `<span class="hl-kw">${escape(all)}</span>`
    else out += escape(all)
    last = match.index + all.length
  }
  return out + escape(text.slice(last))
}
