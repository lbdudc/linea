import postcss from 'postcss';

export function extractBridgeVariables(scssText) {
  const withoutSassComments = scssText.replace(/\/\/.*$/gm, '');
  const root = postcss.parse(withoutSassComments);
  const defined = new Set();

  root.walkRules((rule) => {
    const selectors = rule.selectors ?? [rule.selector];
    if (!selectors.some((s) => s.trim() === ':root')) return;
    for (const node of rule.nodes ?? []) {
      if (node.type !== 'decl') continue;
      if (!node.prop.startsWith('--')) continue;
      defined.add(node.prop);
    }
  });

  return defined;
}
