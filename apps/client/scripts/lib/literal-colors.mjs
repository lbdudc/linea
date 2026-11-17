const RE_LITERAL_COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;

export function countLiteralColors(content) {
  const matches = content.match(RE_LITERAL_COLOR);
  return matches ? matches.length : 0;
}
