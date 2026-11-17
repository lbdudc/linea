const REFERENCES = /\b(?:clos(?:e[sd]?|ing)|fix(?:e[sd]|ing)?|resolv(?:e[sd]?|ing)|implement(?:s|ed|ing)?)\b:?[ \t]+(#\d+(?:[ \t]*(?:,|and|&)[ \t]*#\d+)*)/gi

export const closingIssueNumbers = (...texts: (string | null | undefined)[]): number[] => {
  const found = new Set<number>()
  for (const text of texts) {
    if (!text) continue
    for (const match of text.matchAll(REFERENCES)) {
      for (const number of (match[1] ?? '').matchAll(/#(\d+)/g)) found.add(Number(number[1]))
    }
  }
  return [...found]
}
