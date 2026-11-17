import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';

import { calculateMissing, extractDefinedVariables, extractUsedVariablesFromText } from './lib/tokens-by-theme.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = path.resolve(__dirname, '..', 'src', 'theme', 'tokens.css');
const ORIGINAL_CSS = readFileSync(TOKENS_PATH, 'utf8');

const DARK_STATUS_OK_DECL = '  --status-ok: #22c55e;\n';

test('good case: the real tokens.css defines --status-ok in both themes', () => {
  const defined = extractDefinedVariables(ORIGINAL_CSS);
  assert.ok(defined.dark.has('--status-ok'), 'should be in dark/:root');
  assert.ok(defined.light.has('--status-ok'), 'should be in light');
});

test('good case: a token used and defined in both themes is missing in neither', () => {
  const defined = extractDefinedVariables(ORIGINAL_CSS);
  const used = extractUsedVariablesFromText('<div style="color: var(--status-ok)"></div>');
  const { missingInDark, missingInLight } = calculateMissing(used, defined);
  assert.deepEqual(missingInDark, []);
  assert.deepEqual(missingInLight, []);
});

test('mutation "remove a token" (dark block only): the guard catches it', () => {
  assert.ok(ORIGINAL_CSS.includes(DARK_STATUS_OK_DECL), 'stale fixture: the line to mutate was not found');
  const mutatedCss = ORIGINAL_CSS.replace(DARK_STATUS_OK_DECL, '');

  const defined = extractDefinedVariables(mutatedCss);
  assert.ok(!defined.dark.has('--status-ok'), 'should no longer be in dark after removing it');
  assert.ok(defined.light.has('--status-ok'), 'should still be in light: that block was not touched');

  const used = extractUsedVariablesFromText('var(--status-ok)');
  const { missingInDark, missingInLight } = calculateMissing(used, defined);
  assert.deepEqual(missingInDark, ['--status-ok']);
  assert.deepEqual(missingInLight, []);
});

test('mutation "remove a token AND indent the dark block\'s closing brace": the guard still catches it', () => {
  assert.ok(ORIGINAL_CSS.includes(DARK_STATUS_OK_DECL), 'stale fixture: the line to mutate was not found');

  const withoutTheToken = ORIGINAL_CSS.replace(DARK_STATUS_OK_DECL, '');

  const DARK_BLOCK_CLOSE = '\n}\n\n/* ---------- TEMA CLARO ---------- */';
  assert.ok(withoutTheToken.includes(DARK_BLOCK_CLOSE), 'stale fixture: the dark block closing brace was not found');
  const mutatedCss = withoutTheToken.replace(DARK_BLOCK_CLOSE, '\n  }\n\n/* ---------- TEMA CLARO ---------- */');

  const defined = extractDefinedVariables(mutatedCss);
  assert.ok(!defined.dark.has('--status-ok'), 'still missing in dark despite the indented brace');
  assert.ok(defined.light.has('--status-ok'), "light keeps its own --status-ok, it wasn't merged with dark");

  const used = extractUsedVariablesFromText('var(--status-ok)');
  const { missingInDark, missingInLight } = calculateMissing(used, defined);
  assert.deepEqual(missingInDark, ['--status-ok'], 'the guard must still fail: --status-ok is missing in dark');
  assert.deepEqual(missingInLight, []);
});

test('mutation "the token is declared in a rule nested inside the block": the guard catches it', () => {
  const withoutTheToken = ORIGINAL_CSS.replace(DARK_STATUS_OK_DECL, '');
  assert.notEqual(withoutTheToken, ORIGINAL_CSS, 'stale fixture: the dark block declaration was not found');

  const DARK_BLOCK_CLOSE = '\n}\n\n/* ---------- TEMA CLARO ---------- */';
  assert.ok(withoutTheToken.includes(DARK_BLOCK_CLOSE), 'stale fixture: the dark block closing brace was not found');
  const mutatedCss = withoutTheToken.replace(
    DARK_BLOCK_CLOSE,
    '\n  .solo-una-variante { --status-ok: #22c55e; }\n}\n\n/* ---------- TEMA CLARO ---------- */',
  );

  const defined = extractDefinedVariables(mutatedCss);
  assert.ok(!defined.dark.has('--status-ok'), 'a nested declaration does NOT count as defined at the root');

  const used = extractUsedVariablesFromText('var(--status-ok)');
  const { missingInDark } = calculateMissing(used, defined);
  assert.deepEqual(missingInDark, ['--status-ok'], 'the guard must fail: --status-ok never reaches the root in dark');
});

test('a used token that does not exist in any theme is missing in both', () => {
  const defined = extractDefinedVariables(ORIGINAL_CSS);
  const used = extractUsedVariablesFromText('var(--p-txt-color)');
  const { missingInDark, missingInLight } = calculateMissing(used, defined);
  assert.deepEqual(missingInDark, ['--p-txt-color']);
  assert.deepEqual(missingInLight, ['--p-txt-color']);
});
