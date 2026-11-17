const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/i;

export function parseColor(value) {
  const text = String(value).trim().toLowerCase();
  if (text === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (text === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = HEX.exec(text);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgb = RGB.exec(text);
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
  }
  return null;
}

export function flatten(foreground, background) {
  const a = foreground.a;
  return {
    r: foreground.r * a + background.r * (1 - a),
    g: foreground.g * a + background.g * (1 - a),
    b: foreground.b * a + background.b * (1 - a),
    a: 1,
  };
}

function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance({ r, g, b }) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(foreground, background, surface) {
  const base = surface ?? { r: 255, g: 255, b: 255, a: 1 };
  const back = background.a < 1 ? flatten(background, base) : background;
  const front = foreground.a < 1 ? flatten(foreground, back) : foreground;
  const lighter = Math.max(luminance(front), luminance(back));
  const darker = Math.min(luminance(front), luminance(back));
  return (lighter + 0.05) / (darker + 0.05);
}

export function readThemeTokens(tokensCss, bridgeCss) {
  const themes = { dark: {}, light: {} };
  const blocks = [...tokensCss.matchAll(/([^{}]+)\{([^}]*)\}/g)];
  for (const [, rawSelector, body] of blocks) {
    const selector = rawSelector.trim();
    const isDark = /(^|,|\s)(:root|\.dark-theme)(\s|,|$)/.test(selector);
    const isLight = /\.light-theme/.test(selector);
    if (!isDark && !isLight) continue;
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      const clean = value.split('/*')[0].trim();
      if (isDark) themes.dark[name] = clean;
      if (isLight) themes.light[name] = clean;
    }
  }
  const bridgeRoot = /:root\s*\{([^}]*)\}/.exec(bridgeCss);
  if (bridgeRoot) {
    for (const [, name, value] of bridgeRoot[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      const clean = value.split('/*')[0].trim();
      for (const theme of Object.values(themes)) {
        if (!(name in theme)) theme[name] = clean;
      }
    }
  }
  return themes;
}

export function resolve(value, tokens, seen = new Set()) {
  const text = String(value).trim();
  const direct = parseColor(text);
  if (direct) return direct;
  const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(text);
  if (!varMatch) return null;
  const [, name, fallback] = varMatch;
  if (seen.has(name)) return null;
  seen.add(name);
  if (tokens[name] !== undefined) return resolve(tokens[name], tokens, seen);
  return fallback ? resolve(fallback, tokens, seen) : null;
}
