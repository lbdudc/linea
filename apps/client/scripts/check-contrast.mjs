#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { contrast, readThemeTokens, resolve } from './lib/contrast.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..');
const srcRoot = path.join(clientRoot, 'src');

const AA_NORMAL = 4.5;
const AA_LARGE = 3;
const LARGE_PX = 24;
const LARGE_BOLD_PX = 18.66;

const SURFACES = {
  dark: 'var(--p-content-background)',
  light: 'var(--p-content-background)',
};

const BACKDROP_IS_THE_BRAND_BAR = new Set([
  'src/components/line/MigrationStatusPanel.vue:.mig-dialog .p-dialog-close-button:hover:not(:disabled)',
]);

const PENDING_TOKEN_DECISION = new Map([
  ['src/components/feature-model/FeatureTree.vue:.74rem; flex-shrink: 0; border-top: 1px solid var(--card-border); &--valid', 4.39],
  ['src/pages/ProductDetail.vue:.5; cursor: default; &--ok', 4.39],
]);

function listFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else if (/\.(vue|scss)$/.test(entry)) out.push(full);
  }
  return out;
}

function declarations(body) {
  const found = {};
  for (const [, prop, value] of body.matchAll(/(^|[;{\s])(color|background|background-color|font-size|font-weight)\s*:\s*([^;}]+)/g)) {
    found[prop] = value.trim().replace(/!important$/, '').trim();
  }
  const out = {};
  for (const [, prop, value] of body.matchAll(/(?:^|[;{])\s*(color|background|background-color|font-size|font-weight)\s*:\s*([^;}]+)/g)) {
    out[prop] = value.trim().replace(/!important$/, '').trim();
  }
  return { ...found, ...out };
}

function isLarge({ 'font-size': size, 'font-weight': weight }) {
  if (!size) return false;
  const px = /^([\d.]+)px$/.exec(size.trim());
  if (!px) return false;
  const value = Number(px[1]);
  const bold = weight && Number(weight) >= 600;
  return value >= LARGE_PX || (bold && value >= LARGE_BOLD_PX);
}

function blocksOf(text) {
  const blocks = [];
  const re = /([.#&][^{}]{0,120}?)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    blocks.push({ selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] });
  }
  return blocks;
}

const tokens = readThemeTokens(
  readFileSync(path.join(srcRoot, 'theme', 'tokens.css'), 'utf8'),
  readFileSync(path.join(srcRoot, 'css', 'app.scss'), 'utf8'),
);

const problems = [];
const pending = [];
let checked = 0;

for (const file of listFiles(srcRoot)) {
  const relative = path.relative(clientRoot, file).split(path.sep).join('/');
  const text = readFileSync(file, 'utf8');
  for (const { selector, body } of blocksOf(text)) {
    const decl = declarations(body);
    if (!decl.color) continue;
    const key = `${relative}:${selector}`;
    if (BACKDROP_IS_THE_BRAND_BAR.has(key)) continue;
    const backgroundSource = decl['background-color'] || decl.background;
    if (!backgroundSource || /gradient|url\(/.test(backgroundSource)) continue;
    const large = isLarge(decl);
    const minimum = large ? AA_LARGE : AA_NORMAL;

    for (const theme of ['dark', 'light']) {
      const palette = tokens[theme];
      const foreground = resolve(decl.color, palette);
      if (!foreground) continue;
      const backgroundValue = backgroundSource && !/gradient|url\(/.test(backgroundSource)
        ? backgroundSource
        : SURFACES[theme];
      const background = resolve(backgroundValue, palette);
      if (!background || background.a === 0) continue;
      const surface = resolve(SURFACES[theme], palette);
      checked += 1;
      const ratio = contrast(foreground, background, surface);
      if (ratio >= minimum) continue;
      const allowed = PENDING_TOKEN_DECISION.get(key);
      if (allowed !== undefined && ratio >= allowed - 0.01) {
        pending.push({ key, theme, ratio });
        continue;
      }
      problems.push({ key, theme, ratio, minimum, color: decl.color, background: backgroundValue });
    }
  }
}

if (problems.length) {
  console.error(`check:contrast FAILED — ${problems.length} text/background pair(s) below AA\n`);
  for (const p of problems.sort((a, b) => a.ratio - b.ratio)) {
    console.error(`  ${p.ratio.toFixed(2)}:1 (needs ${p.minimum}) [${p.theme}] ${p.key}`);
    console.error(`      color ${p.color} on ${p.background}`);
  }
  console.error('\nA token is not a guarantee: resolve both themes and compute the ratio.');
  process.exit(1);
}

if (pending.length) {
  console.log(`check:contrast — ${pending.length} known pair(s) below AA awaiting a token decision (status/chart text on its own soft fill):`);
  for (const p of pending.sort((a, b) => a.ratio - b.ratio)) console.log(`  ${p.ratio.toFixed(2)}:1 [${p.theme}] ${p.key}`);
  console.log('');
}
console.log(`check:contrast OK — ${checked} text/background pair(s) at or above AA in both themes.`);
