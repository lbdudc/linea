import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : full.endsWith('.js') ? [full] : [];
  });

const importsOf = (file) =>
  fs.readFileSync(file, 'utf8').split('\n').filter((line) => /^\s*(import|export)\b|from\s+['"]/.test(line)).join('\n');

describe('the git boundary', () => {
  it('keeps the server away from gitlab-commando and the hosts REST clients: the git hosts are @lbdudc/linea-git', () => {
    const offenders = walk(SRC)
      .filter((file) => !path.relative(SRC, file).startsWith('test'))
      .filter((file) => /gitlab-commando|gitlabClient/.test(importsOf(file)))
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('asks for the git host in one place: model/git', () => {
    const offenders = walk(SRC)
      .filter((file) => !path.relative(SRC, file).startsWith('test'))
      .filter((file) => /createGitProvider|gitConfigFromEnv/.test(importsOf(file)))
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual([path.join('model', 'git', 'index.js')]);
  });
});
