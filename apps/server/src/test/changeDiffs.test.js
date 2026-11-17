import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from 'vitest';
import { describeChanges } from '../model/services/changeDiffs.js';

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'linea-diff-'));

test('every file has its action and a unified diff against the code in the repository', () => {
  const oldDir = folder();
  fs.mkdirSync(path.join(oldDir, 'src'));
  fs.writeFileSync(path.join(oldDir, 'src', 'a.txt'), 'one\ntwo\nthree\n');
  fs.writeFileSync(path.join(oldDir, 'gone.txt'), 'bye\n');

  const { counts, files, truncated } = describeChanges({
    oldDir,
    actions: [
      { action: 'create', file_path: 'new.txt', content: 'hello\n', encoding: 'text' },
      { action: 'update', file_path: 'src/a.txt', content: 'one\n2\nthree\n', encoding: 'text' },
      { action: 'delete', file_path: 'gone.txt' },
      { action: 'create', file_path: 'logo.png', content: 'AAAA', encoding: 'base64' },
    ],
  });

  expect(counts).toEqual({ create: 2, update: 1, delete: 1 });
  expect(truncated).toBe(false);
  const byPath = Object.fromEntries(files.map((file) => [file.path, file]));
  expect(byPath['new.txt']).toMatchObject({ action: 'create', added: 1, removed: 0 });
  expect(byPath['new.txt'].diff).toContain('+hello');
  expect(byPath['src/a.txt']).toMatchObject({ action: 'update', added: 1, removed: 1 });
  expect(byPath['src/a.txt'].diff).toContain('-two');
  expect(byPath['src/a.txt'].diff).toContain('+2');
  expect(byPath['gone.txt']).toMatchObject({ action: 'delete', added: 0, removed: 1 });
  expect(byPath['logo.png'].diff).toBeNull();
});

test('a file whose diff does not fit the size limit is listed without it', () => {
  const oldDir = folder();
  const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
  const { files } = describeChanges({ oldDir, actions: [{ action: 'create', file_path: 'big.txt', content: big, encoding: 'text' }] });
  expect(files[0]).toMatchObject({ path: 'big.txt', action: 'create', diff: null, added: 5000 });
});

test('only the first files are listed, and it says so', () => {
  const oldDir = folder();
  const actions = Array.from({ length: 320 }, (_, i) => ({ action: 'create', file_path: `f${String(i).padStart(3, '0')}.txt`, content: 'x\n', encoding: 'text' }));
  const { counts, files, truncated } = describeChanges({ oldDir, actions });
  expect(counts.create).toBe(320);
  expect(files).toHaveLength(300);
  expect(truncated).toBe(true);
});
