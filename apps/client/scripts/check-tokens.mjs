#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { calculateMissing, extractDefinedVariables, extractUsedVariablesFromText } from './lib/tokens-by-theme.mjs';
import { extractBridgeVariables } from './lib/bridge-variables.mjs';
import { extractLocallyDeclaredVariables } from './lib/local-variables.mjs';
import { countLiteralColors } from './lib/literal-colors.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLIENT_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(CLIENT_ROOT, 'src');

const MOCKS = ['Despliegues', 'DetalleProducto', 'EditorModelo', 'Lineas', 'Main', 'Productos', 'Sistema']
  .map((name) => path.join(WORKSPACE_ROOT, 'diseno-linea', `${name}.dc.html`))
  .filter((filePath) => existsSync(filePath));
const HAS_MOCKS = MOCKS.length === 7;

const TOKENS_PATH = path.join(SRC_ROOT, 'theme', 'tokens.css');
const PRESET_PATH = path.join(SRC_ROOT, 'theme', 'preset-linea.js');
const TOKENS_SOURCE_PATH = path.join(WORKSPACE_ROOT, 'docs', 'guia-front', 'tokens.css');
const PRESET_SOURCE_PATH = path.join(WORKSPACE_ROOT, 'docs', 'guia-front', 'preset-linea.js');

const APP_SCSS_PATH = path.join(SRC_ROOT, 'css', 'app.scss');

const APP_CODE_EXTENSIONS = new Set(['.vue', '.css', '.js', '.scss']);

const PATHS_EXCLUDED_FROM_USAGE = new Set([TOKENS_PATH, PRESET_PATH, APP_SCSS_PATH]);

function listFilesRecursively(directory, extensions) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...listFilesRecursively(fullPath, extensions));
      continue;
    }
    if (!entry.isFile()) continue;
    if (PATHS_EXCLUDED_FROM_USAGE.has(fullPath)) continue;
    if (extensions.has(path.extname(entry.name))) found.push(fullPath);
  }
  return found;
}

function readIfExists(filePath) {
  try {
    return statSync(filePath).isFile() ? readFileSync(filePath, 'utf8') : null;
  } catch {
    return null;
  }
}

function collectUsageSources() {
  const appCodePaths = listFilesRecursively(SRC_ROOT, APP_CODE_EXTENSIONS);
  return [...MOCKS, ...appCodePaths];
}

function checkFaithfulCopy(copyPath, sourcePath, label, errors) {
  const copy = readIfExists(copyPath);
  const source = readIfExists(sourcePath);
  if (source === null) {
    errors.push(`  - ${label}: could not read the source (${sourcePath})`);
    return;
  }
  if (copy === null) {
    errors.push(`  - ${label}: could not read the copy (${copyPath})`);
    return;
  }
  if (copy !== source) {
    errors.push(
      `  - ${label}: ${copyPath} has drifted from ${sourcePath} (copy it again, byte for byte; do not adapt the copy)`,
    );
  }
}

const LITERAL_COLOR_BASELINE_BY_FOLDER = {
  'components/common': 1,
  'components/dashboard': 0,
  'components/user': 2,
  layouts: 12,
  'modules/uvl-editor': 4,
  pages: 2,
};

function countLiteralColorsTotal() {
  const filePaths = listFilesRecursively(SRC_ROOT, APP_CODE_EXTENSIONS);
  const byFile = [];
  const byFolder = {};
  let total = 0;
  for (const filePath of filePaths) {
    const content = readIfExists(filePath);
    if (content === null) continue;
    const n = countLiteralColors(content);
    if (n > 0) {
      total += n;
      byFile.push({ file: path.relative(CLIENT_ROOT, filePath), n });
      const folder = path.relative(SRC_ROOT, path.dirname(filePath)).split(path.sep).join('/') || '.';
      byFolder[folder] = (byFolder[folder] ?? 0) + n;
    }
  }
  return { total, byFolder, byFile: byFile.sort((a, b) => b.n - a.n) };
}

function main() {
  let fails = false;

  const tokensCss = readFileSync(TOKENS_PATH, 'utf8');
  const tokensDefined = extractDefinedVariables(tokensCss);
  const bridgeAppScss = readIfExists(APP_SCSS_PATH);
  const bridgeDefined = bridgeAppScss ? extractBridgeVariables(bridgeAppScss) : new Set();
  const defined = {
    dark: new Set([...tokensDefined.dark, ...bridgeDefined]),
    light: new Set([...tokensDefined.light, ...bridgeDefined]),
  };

  const usagePaths = collectUsageSources();
  const used = new Set();
  const notFound = [];
  for (const filePath of usagePaths) {
    const content = readIfExists(filePath);
    if (content === null) {
      notFound.push(filePath);
      continue;
    }
    const localToThisFile = extractLocallyDeclaredVariables(content);
    for (const name of extractUsedVariablesFromText(content)) {
      if (localToThisFile.has(name)) continue;
      used.add(name);
    }
  }

  if (notFound.length) {
    console.error('Could not read these files (path moved?):');
    for (const filePath of notFound) console.error(`  - ${filePath}`);
    process.exit(1);
  }

  const { missingInDark, missingInLight } = calculateMissing(used, defined);

  const copyErrors = [];
  const hasSource = existsSync(TOKENS_SOURCE_PATH) && existsSync(PRESET_SOURCE_PATH);
  if (hasSource) {
    checkFaithfulCopy(TOKENS_PATH, TOKENS_SOURCE_PATH, 'tokens.css', copyErrors);
    checkFaithfulCopy(PRESET_PATH, PRESET_SOURCE_PATH, 'preset-linea.js', copyErrors);
  }

  if (!HAS_MOCKS || !hasSource) {
    const missing = [];
    if (!HAS_MOCKS) missing.push('the mocks in diseno-linea/');
    if (!hasSource) missing.push('the source of truth in docs/guia-front/');
    console.warn(
      `check:tokens — WARNING: not checked against ${missing.join(' nor ')}, ` +
        'because it is not in this tree. Outside the full workspace this check is PARTIAL.',
    );
  }

  if (missingInDark.length || missingInLight.length) {
    fails = true;
    console.error(
      `check:tokens — ${used.size} variables used across ${usagePaths.length} files (${MOCKS.length} mocks + app code), missing definitions in tokens.css:\n`,
    );
    if (missingInDark.length) {
      console.error(`  .dark-theme / :root (${missingInDark.length}):`);
      for (const name of missingInDark) console.error(`    - ${name}`);
    }
    if (missingInLight.length) {
      console.error(`  .light-theme (${missingInLight.length}):`);
      for (const name of missingInLight) console.error(`    - ${name}`);
    }
  }

  if (copyErrors.length) {
    fails = true;
    console.error('\ncheck:tokens — drift against the source of truth (docs/guia-front/):');
    for (const line of copyErrors) console.error(line);
  }

  if (!fails) {
    console.log(
      `check:tokens OK (1/2) — ${used.size} variables used across ${usagePaths.length} files (${MOCKS.length} mocks + app code), all defined in .dark-theme/:root and .light-theme of tokens.css${HAS_MOCKS ? '; tokens.css and preset-linea.js are still a faithful copy of docs/guia-front/' : ''}.`,
    );
  }

  const { total, byFolder, byFile } = countLiteralColorsTotal();

  console.log(
    `\ncheck:tokens (2/2) — ${total} literal color(s) outside tokens.css/preset-linea.js, in ${byFile.length} file(s):`,
  );
  for (const { file, n } of byFile) console.log(`  - ${file}: ${n}`);

  console.log('\ncheck:tokens (2/2) — by folder (baseline in parentheses):');
  const folders = new Set([...Object.keys(byFolder), ...Object.keys(LITERAL_COLOR_BASELINE_BY_FOLDER)]);
  const increases = [];
  for (const folder of [...folders].sort()) {
    const n = byFolder[folder] ?? 0;
    const base = LITERAL_COLOR_BASELINE_BY_FOLDER[folder] ?? 0;
    const mark = n > base ? '  <-- WENT UP' : n < base ? '  (went down)' : '';
    console.log(`  - ${folder}: ${n} (${base})${mark}`);
    if (n > base) increases.push({ folder, n, base });
  }

  if (increases.length) {
    fails = true;
    console.error('\ncheck:tokens — the number of literal colors WENT UP in these folders:');
    for (const { folder, n, base } of increases) console.error(`  - ${folder}: ${n} > ${base}`);
    console.error(
      '\nUse var(--…). If a token is missing, add it to docs/guia-front/tokens.css with its TWO values, copy it byte for byte to both modules, and document it in GUIA-FRONT-PRIMEVUE.md — do not hardcode it.\n' +
        "And don't lower another folder's baseline to compensate: it is counted per folder precisely so that cannot slip through.",
    );
  }

  if (fails) {
    console.error('\ncheck:tokens FAILED — see the errors above.');
    process.exit(1);
  }

  console.log(`\ncheck:tokens OK (2/2) — ${total} literal(s) in total, no folder above its baseline.`);
}

main();
