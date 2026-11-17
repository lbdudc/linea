import postcss from 'postcss';

const RE_VAR_USAGE = /var\(\s*(--[a-zA-Z0-9-]+)/g;

export function extractUsedVariablesFromText(content) {
  const names = new Set();
  for (const match of content.matchAll(RE_VAR_USAGE)) {
    names.add(match[1]);
  }
  return names;
}

export function extractDefinedVariables(cssText) {
  const root = postcss.parse(cssText);
  const dark = new Set();
  const light = new Set();

  root.walkRules((rule) => {
    const selectors = rule.selectors ?? [rule.selector];
    const isDark = selectors.some((s) => s.trim() === ':root' || s.trim() === '.dark-theme');
    const isLight = selectors.some((s) => s.trim() === '.light-theme');
    if (!isDark && !isLight) return;

    for (const node of rule.nodes ?? []) {
      if (node.type !== 'decl') continue;
      if (!node.prop.startsWith('--')) continue;
      if (isDark) dark.add(node.prop);
      if (isLight) light.add(node.prop);
    }
  });

  return { dark, light };
}

export function calculateMissing(used, defined) {
  const missingInDark = [...used].filter((v) => !defined.dark.has(v)).sort();
  const missingInLight = [...used].filter((v) => !defined.light.has(v)).sort();
  return { missingInDark, missingInLight };
}
