import { describe, it, expect } from 'bun:test';
import path from 'node:path';
import { writeOrigin } from '../src/core/gitops.js';
import { makeSession, newPlainLine, run, useTmpDirs } from './helpers.js';

// The commands around the work: the page of what you are in, its folder, its path.

const tmpDir = useTmpDirs('linea-cli-system');

async function workspace() {
  const workdir = tmpDir();
  const session = makeSession(workdir, { local: true });
  const dir = await newPlainLine(session, 'alpha');
  return { workdir, session, dir };
}

describe('browse, reveal, copy (with --print: what they would do)', () => {
  it('browse gives the page on LINEA when the SPL came from there, and its repository with --repo', async () => {
    const { session, dir } = await workspace();
    writeOrigin(dir, {
      kind: 'spl',
      name: 'alpha',
      provider: 'gitlab',
      projectId: 7,
      webUrl: 'https://git.example/g/alpha',
      defaultBranch: 'main',
      lineId: 'L1',
      webUi: 'https://linea.example',
    });
    const here = { ...session, cwd: dir };
    expect(await run(here, 'browse', '--print')).toBe('https://linea.example/lines/L1');
    expect(await run(here, 'browse', '--repo', '--print')).toBe('https://git.example/g/alpha');
    // from a folder inside it, the same page
    expect(await run({ ...here, cwd: path.join(dir, 'src') }, 'browse', '--print')).toBe('https://linea.example/lines/L1');
  });

  it('browse takes an address or a location as it is, and says when there is no page yet', async () => {
    const { session, dir } = await workspace();
    expect(await run(session, 'browse', 'https://example.org/x', '--print')).toBe('https://example.org/x');
    await expect(run({ ...session, cwd: dir }, 'browse', '--print')).rejects.toThrow(/only on this machine/);
  });

  it('reveal and copy name the folder of what is meant', async () => {
    const { session, dir } = await workspace();
    const here = { ...session, cwd: dir };
    expect(await run(here, 'reveal', '--print')).toBe(dir);
    expect(await run(here, 'copy', '--print')).toBe(dir);
    expect(await run(here, 'reveal', 'fm', '--print')).toContain('featuremodel.featuremodel');
  });
});
