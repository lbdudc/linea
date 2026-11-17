import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { findPlace, placesFrom } from '../src/core/places.js';
import { colorize, parseLine, TONE_COLOR } from '../src/ui/style.js';
import { makeSession, newPlainLine, run, useTmpDirs } from './helpers.js';

// Things are known by their names: `cd` goes to an SPL or a product by name (not by path), and `spl list` colours each SPL by where it is.

const tmpDir = useTmpDirs('linea-cli-names');
const cwd0 = process.cwd();

/** A workspace with SPLs `alpha` (products `shop` and `web`) and `beta`, and the session standing in the workspace, in the window. */
async function workspace() {
  const workdir = tmpDir();
  const session = makeSession(workdir, { interactive: true });
  const spec = (name: string) => path.join(workdir, `${name}.json`);
  try {
    await newPlainLine(session, 'alpha');
    for (const name of ['shop', 'web']) {
      fs.writeFileSync(spec(name), JSON.stringify({ basicData: { name, version: '0.0.1' } }));
      await run(session, 'product new', '--from', spec(name));
    }
    await newPlainLine(session, 'beta');
  } finally {
    process.chdir(cwd0);
  }
  session.cwd = workdir;
  return { workdir, session };
}

describe('cd goes by name', () => {
  it('to an SPL from anywhere, to a product from inside its SPL, and up with ..', async () => {
    const { workdir, session } = await workspace();
    try {
      expect(await run(session, 'cd', 'alpha')).toContain('(SPL alpha)');
      expect(session.cwd).toBe(path.join(workdir, 'alpha'));

      expect(await run(session, 'cd', 'shop')).toContain('(product shop)');
      expect(session.cwd).toBe(path.join(workdir, 'alpha', 'shop'));

      // from a product, another SPL is still one name away, whatever the case
      expect(await run(session, 'cd', 'BETA')).toContain('(SPL beta)');
      expect(session.cwd).toBe(path.join(workdir, 'beta'));

      await run(session, 'cd', 'alpha');
      await run(session, 'cd', 'web');
      await run(session, 'cd', '..');
      expect(session.cwd).toBe(path.join(workdir, 'alpha'));
      await run(session, 'cd', '..');
      expect(session.cwd).toBe(workdir);

      // no name: the workspace
      await run(session, 'cd', 'beta');
      await run(session, 'cd');
      expect(session.cwd).toBe(workdir);
    } finally {
      process.chdir(cwd0);
    }
  });

  it('a product of the SPL you are in wins over an SPL of the same name, and a wrong name says what there is', async () => {
    const { workdir, session } = await workspace();
    try {
      // an SPL called shop too
      session.cwd = workdir;
      await newPlainLine(session, 'shop');
      process.chdir(cwd0);
      session.cwd = path.join(workdir, 'alpha');
      await run(session, 'cd', 'shop');
      expect(session.cwd).toBe(path.join(workdir, 'alpha', 'shop')); // the product, being in alpha

      await expect(run(session, 'cd', 'nowhere')).rejects.toThrow(/No SPL, product, module or metamodel called "nowhere"\. Here: .*alpha/);
    } finally {
      process.chdir(cwd0);
    }
  });

  it('does nothing in a shell, which has its own cd', async () => {
    const { session } = await workspace();
    session.interactive = false;
    expect(await run(session, 'cd', 'alpha')).toContain('in a shell, cd to the folder yourself');
  });
});

describe('places', () => {
  it('lists the products of the SPL you are in first, then the SPLs and the packages of the workspace', async () => {
    const { workdir, session } = await workspace();
    const places = placesFrom(path.join(workdir, 'alpha'), workdir);
    expect(places.map((p) => `${p.kind}:${p.name}`)).toEqual(['product:shop', 'product:web', 'SPL:alpha', 'SPL:beta', 'metamodel:common', 'metamodel:featuremodel']);
    expect(findPlace(places, 'WEB')?.dir).toBe(path.join(workdir, 'alpha', 'web'));
    expect(placesFrom(workdir, workdir).map((p) => p.name)).toEqual(['alpha', 'beta', 'common', 'featuremodel']);
    void session;
  });
});

describe('colours of spl list', () => {
  const rows = [
    '  gis       here + LINEA  v1.0.0  ~\\ws\\gis',
    '  sketch    here only     v1.0.0',
    '  elsewhere LINEA only    v2.0.0    (get elsewhere)',
  ];

  it('the name and where it is share one colour: green both, yellow here only, cyan LINEA only', () => {
    const tones = rows.map((r) => parseLine(r).filter((p) => p.tone !== 'plain' && p.tone !== 'dim').map((p) => p.tone));
    expect(tones).toEqual([['ok', 'ok'], ['warn', 'warn'], ['info', 'info']]);
    // the text is never changed, only coloured
    for (const r of rows) expect(parseLine(r).map((p) => p.text).join('')).toBe(r);
  });

  it('a terminal gets the colours as ANSI, a pipe gets the plain text', () => {
    const ESC = String.fromCharCode(27);
    const coloured = colorize(rows.join('\n'), true);
    expect(coloured).toContain(`${ESC}[38;2;`);
    expect(coloured.replaceAll(/\u001b\[[0-9;]*m/g, '')).toBe(rows.join('\n'));
    expect(colorize(rows.join('\n'), false)).toBe(rows.join('\n'));
    expect(new Set([TONE_COLOR.ok, TONE_COLOR.warn, TONE_COLOR.info]).size).toBe(3);
  });
});
