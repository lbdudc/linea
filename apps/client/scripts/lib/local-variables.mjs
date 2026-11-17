const RE_LOCAL_DECLARATION = /(?<!var\()(--[a-zA-Z0-9-]+)(?=['"]?\s*:)/g;

export function extractLocallyDeclaredVariables(content) {
  const names = new Set();
  for (const match of content.matchAll(RE_LOCAL_DECLARATION)) {
    names.add(match[1]);
  }
  return names;
}
