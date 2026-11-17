import { withFeatureMetamodel, setLineModel, seededWorkspace } from './helpers.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn , setDefaultTimeout } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GitLabProvider, clearReadCache } from '@lbdudc/linea-git';
import { startGitlabDouble } from '@lbdudc/linea-git/testing';
import { createLocalModularLine, setLocalLineModules } from '../src/core/workspace.js';
import { readOrigin } from '../src/core/gitops.js';
import { runShell } from '../src/shell.js';

// real git, one process per call: slow on some machines
setDefaultTimeout(60_000);

const ENV = ['LINEA_HOME', 'GIT_PROVIDER', 'GITLAB_HOSTNAME', 'GITLAB_TOKEN', 'GITHUB_TOKEN', 'LINEA_GIT_TOKEN', 'LINEA_TRUSTED_NAMESPACES', 'LINEA_REGISTRY', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];
const saved: Record<string, string | undefined> = {};
const cwd0 = process.cwd();
let tmp: string;
let ws: string;
let double: Awaited<ReturnType<typeof startGitlabDouble>>;

// (everything is inside one describe: hooks outside any describe would run for the tests of the other files too)
describe('the package commands', () => {
beforeAll(() => {
  for (const k of ENV) saved[k] = process.env[k];
});
afterAll(() => {
  for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});

beforeEach(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linea-packages-')));
  withFeatureMetamodel(tmp);
  process.env['LINEA_HOME'] = path.join(tmp, 'home');
  fs.mkdirSync(process.env['LINEA_HOME'], { recursive: true });
  delete process.env['LINEA_TRUSTED_NAMESPACES'];
  delete process.env['LINEA_REGISTRY'];
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Ana', GIT_AUTHOR_EMAIL: 'a@example.com', GIT_COMMITTER_NAME: 'Ana', GIT_COMMITTER_EMAIL: 'a@example.com' });
  double = await startGitlabDouble();
  Object.assign(process.env, { GIT_PROVIDER: 'gitlab', GITLAB_HOSTNAME: double.url, GITLAB_TOKEN: 'tok' });
  await new GitLabProvider({ url: double.url }).createNamespace({ token: 'tok', name: 'registry' });
  ws = seededWorkspace(path.join(tmp, 'ws'));
  withFeatureMetamodel(ws);
  process.chdir(ws);
});
afterEach(async () => {
  // (what was read from a host is kept by its address, and the next test's double may take the same one)
  clearReadCache();
  delete process.env['LINEA_REGISTRY'];
  process.chdir(cwd0);
  await double.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sh = async (...argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runShell(
    argv,
    { write: (s: string) => out.push(s) } as unknown as NodeJS.WriteStream,
    { write: (s: string) => err.push(s), isTTY: false } as unknown as NodeJS.WriteStream,
  );
  return { code, out: out.join(''), err: err.join('') };
};

const edit = (file: string, change: (json: Record<string, unknown>) => void) => {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(json);
  fs.writeFileSync(file, JSON.stringify(json, null, 2));
};

describe('module and metamodel', () => {
  /** shapes (metamodel) ← draw (module) */
  const author = async () => {
    expect((await sh('metamodel', 'new', 'shapes', 'Some', 'shapes')).code).toBe(0);
    expect((await sh('module', 'new', 'draw')).code).toBe(0);
    edit(path.join(ws, 'modules', 'draw', '.linea', 'module.json'), (m) => {
      (m['requires'] as { metamodels: Record<string, string> }).metamodels = { 'file:metamodels/shapes': '^0.1.0' };
    });
  };

  it('creates, lists and shows them, and says who uses a module', async () => {
    await author();
    expect((await sh('module', 'list')).out).toMatch(/module\s+draw\s+v0\.1\.0/);
    expect((await sh('module', 'list')).out).not.toMatch(/shapes/);
    expect((await sh('metamodel', 'list')).out).toMatch(/metamodel\s+shapes/);
    expect((await sh('module', 'list', 'zzz')).out).toMatch(/No modules .* matching "zzz"/);

    const line = createLocalModularLine({ workdir: ws, name: 'gis' });
    await setLocalLineModules(ws, line.dir, { 'file:modules/draw': '^0.1.0' });
    const shown = await sh('module', 'show', 'draw');
    expect(shown.out).toMatch(/module draw {2}v0\.1\.0/);
    expect(shown.out).toMatch(/metamodels: file:metamodels\/shapes \^0\.1\.0/);
    expect(shown.out).toMatch(/used by:\s+gis/);
    expect((await sh('module', 'show', 'nope')).err).toMatch(/No module "nope"/);
  });

  it('checks a package by name, or from inside its folder, and says what is wrong', async () => {
    await author();
    expect((await sh('check', 'draw')).out).toMatch(/✓ module draw v0\.1\.0 checks out/);
    expect((await sh('metamodel', 'check', 'shapes')).out).toMatch(/✓ metamodel shapes/);

    process.chdir(path.join(ws, 'modules', 'draw'));
    expect((await sh('check')).out).toMatch(/✓ module draw/);

    edit(path.join(ws, 'modules', 'draw', '.linea', 'module.json'), (m) => {
      (m['requires'] as { metamodels: Record<string, string> }).metamodels = { 'file:metamodels/missing': '^1.0.0' };
    });
    const broken = await sh('check');
    expect(broken.code).toBe(1);
    expect(broken.out).toMatch(/✗ module draw has problems/);
  });

  it('publishes a version, raising it with --bump, and lists it on the host', async () => {
    await author();
    const dry = await sh('module', 'publish', 'draw', '--to', 'registry', '--bump', 'minor', '--dry-run');
    expect(dry.out).toMatch(/would publish module draw v0\.1\.0 → 0\.2\.0/);
    expect(JSON.parse(fs.readFileSync(path.join(ws, 'modules', 'draw', '.linea', 'module.json'), 'utf8')).version).toBe('0.1.0');

    expect((await sh('metamodel', 'publish', 'shapes', '--to', 'registry')).out).toMatch(/✓ Published metamodel shapes v0\.1\.0/);
    // the module is published as it points to the metamodel in the registry: it has to be there by its location
    const first = await sh('module', 'publish', 'draw', '--to', 'registry');
    expect(first.err).toBe('');
    expect(first.out).toMatch(/✓ Published module draw v0\.1\.0 → registry\/modules\/draw/);

    expect((await sh('module', 'publish', 'draw', '--to', 'registry')).out).toMatch(/already published/);

    const bumped = await sh('module', 'publish', 'draw', '--to', 'registry', '--bump', 'patch');
    expect(bumped.out).toMatch(/✓ Published module draw v0\.1\.1/);
    expect(JSON.parse(fs.readFileSync(path.join(ws, 'modules', 'draw', '.linea', 'module.json'), 'utf8')).version).toBe('0.1.1');

    const remote = await sh('module', 'list', '--remote');
    expect(remote.out).toMatch(/module\s+draw\s+v0\.1\.1\s+gitlab:registry\/modules\/draw/);
    expect((await sh('module', 'show', 'gitlab:registry/modules/draw')).out).toMatch(/versions: v0\.1\.1, v0\.1\.0/);
  });

  it('lists what is registered when there is a registry, and registers and removes packages', async () => {
    await author();
    expect((await sh('metamodel', 'publish', 'shapes', '--to', 'registry')).out).toMatch(/✓ Published/);
    expect((await sh('module', 'publish', 'draw', '--to', 'registry')).out).toMatch(/✓ Published/);

    // without LINEA_REGISTRY, every repository with the topic is listed and there is no catalog to manage
    expect((await sh('module', 'list', '--remote')).out).toMatch(/draw/);
    const none = await sh('registry', 'list');
    expect(none.code).toBe(1);
    expect(none.err).toMatch(/No registry is set/);

    process.env['LINEA_REGISTRY'] = 'gitlab:registry/index';
    expect((await sh('registry', 'list')).out).toMatch(/Nothing is registered in gitlab:registry\/index/);
    expect((await sh('module', 'list', '--remote')).out).toMatch(/No modules in the registry gitlab:registry\/index/);

    const added = await sh('registry', 'add', 'gitlab:registry/modules/draw');
    expect(added.out).toMatch(/✓ Registered module draw \(gitlab:registry\/modules\/draw\) in gitlab:registry\/index/);
    expect((await sh('registry', 'add', 'gitlab:registry/metamodels/shapes')).out).toMatch(/✓ Registered metamodel shapes/);

    expect((await sh('registry', 'list')).out).toMatch(/metamodel\s+shapes[\s\S]*module\s+draw/);
    expect((await sh('registry', 'list', '--kind', 'module')).out).not.toMatch(/shapes/);
    expect((await sh('module', 'list', '--remote')).out).toMatch(/module\s+draw\s+v0\.1\.0\s+gitlab:registry\/modules\/draw/);
    expect((await sh('metamodel', 'list', '--remote')).out).not.toMatch(/draw/);

    expect((await sh('registry', 'add', 'gitlab:registry/modules/nothing')).code).toBe(1);
    const usage = await sh('registry', 'add', 'draw');
    expect(usage.out + usage.err).toMatch(/Usage: registry add/);

    expect((await sh('registry', 'remove', 'gitlab:registry/modules/draw')).out).toMatch(/✓ Removed/);
    expect((await sh('registry', 'remove', 'gitlab:registry/modules/draw')).out).toMatch(/is not registered/);
    expect((await sh('module', 'list', '--remote')).out).toMatch(/No modules in the registry/);
  });

  it('does not publish what does not check out, and needs to know where to', async () => {
    await author();
    edit(path.join(ws, 'modules', 'draw', '.linea', 'module.json'), (m) => {
      (m['requires'] as { metamodels: Record<string, string> }).metamodels = { 'file:metamodels/missing': '^1.0.0' };
    });
    const blocked = await sh('module', 'publish', 'draw', '--to', 'registry');
    expect(blocked.out).toMatch(/✗ Not published: draw does not pass its check/);
    expect((await sh('module', 'list', '--remote')).out).toMatch(/No modules/);

    const nowhere = await sh('module', 'publish', 'draw');
    expect(nowhere.code).toBe(1);
    expect(nowhere.err).toMatch(/Say where to publish it/);
  });

  it('clones a package of the host into the workspace, remembering where to publish it back', async () => {
    // a repository on "the host" that is a bare repository on disk
    const bare = path.join(tmp, 'remote', 'auth.git');
    fs.mkdirSync(bare, { recursive: true });
    const run = (cwd: string, ...args: string[]) => {
      const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(r.stderr);
    };
    run(bare, 'init', '--bare', '--quiet', '-b', 'main');
    const seed = path.join(tmp, 'seed');
    fs.mkdirSync(seed);
    run(seed, 'init', '--quiet', '-b', 'main');
    fs.mkdirSync(path.join(seed, '.linea'), { recursive: true });
    fs.writeFileSync(path.join(seed, '.linea', 'module.json'), JSON.stringify({ name: 'auth', version: '1.0.0', requires: { modules: {}, metamodels: {} }, offers: {} }));
    run(seed, 'add', '-A');
    run(seed, 'commit', '--quiet', '-m', 'first');
    run(seed, 'push', '--quiet', pathToFileURL(bare).href, 'HEAD:refs/heads/main');

    const found = spyOn(GitLabProvider.prototype, 'findRepository').mockResolvedValue({
      id: 5, name: 'auth', path: 'registry/modules/auth', description: '', webUrl: pathToFileURL(path.join(tmp, 'remote', 'auth')).href,
      webIdeUrl: '', namespaceId: 1, topics: ['linea-module'], defaultBranch: 'main',
    } as never);
    try {
      const r = await sh('module', 'clone', 'gitlab:registry/modules/auth');
      expect(r.err).toBe('');
      expect(r.out).toMatch(/✓ module auth → /);
      expect(r.out).toMatch(/publish puts it back under registry/);
      expect(fs.existsSync(path.join(ws, 'modules', 'auth', '.git'))).toBe(true);
      expect(readOrigin(path.join(ws, 'modules', 'auth'))).toMatchObject({ kind: 'module', publishRoot: 'registry', projectId: 5 });
      expect((await sh('module', 'list')).out).toMatch(/module\s+auth\s+v1\.0\.0/);
      expect((await sh('module', 'clone', 'gitlab:registry/modules/auth')).out).toMatch(/already here/);

      // it is a module, not a metamodel
      expect((await sh('metamodel', 'clone', 'gitlab:registry/modules/auth')).err).toMatch(/is not a metamodel/);
    } finally {
      found.mockRestore();
    }
  });
});

describe('spl update and product features', () => {
  it('takes the newest version a range allows, and shows what changed', async () => {
    expect((await sh('module', 'new', 'draw')).code).toBe(0);
    const manifest = path.join(ws, 'modules', 'draw', '.linea', 'module.json');
    edit(manifest, (m) => { m['version'] = '1.0.0'; });
    const line = createLocalModularLine({ workdir: ws, name: 'gis' });
    await setLocalLineModules(ws, line.dir, { 'file:modules/draw': '^1.0.0' });
    process.chdir(line.dir);
    expect((await sh('spl', 'update')).out).toMatch(/Already on the newest versions/);

    edit(manifest, (m) => { m['version'] = '1.2.0'; });
    const updated = await sh('spl', 'update');
    expect(updated.err).toBe('');
    expect(updated.out).toMatch(/1 change\(s\) pinned/);
    expect(updated.out).toMatch(/modules\/draw\s+1\.0\.0 → 1\.2\.0/);
    expect(JSON.parse(fs.readFileSync(path.join(line.dir, 'linea.lock.json'), 'utf8')).packages['file:modules/draw'].version).toBe('1.2.0');
    expect((await sh('spl', 'update', 'nothing')).err).toMatch(/not in the lockfile/);
  });

  it('shows, adds and removes the features a product selects, and refuses one that does not exist', async () => {
    expect((await sh('spl', 'new', 'shop', '--plain', '--local')).code).toBe(0);
    const line = path.join(ws, 'shop');
    await setLineModel(line, 'features\n\tShop\n\t\toptional\n\t\t\tCart\n\t\t\tWishlist\n');
    process.chdir(line);
    expect((await sh('product', 'new', 'web', '--features', 'Shop')).code).toBe(0);

    expect((await sh('product', 'features', 'web')).out).toMatch(/web selects 1 feature\(s\):\n\s+Shop/);
    const added = await sh('product', 'features', 'web', '--add', 'Cart,Wishlist');
    expect(added.err).toBe('');
    expect(added.out).toMatch(/now selects: Shop, Cart, Wishlist/);
    expect((await sh('product', 'features', 'web', '--remove', 'Wishlist')).out).toMatch(/now selects: Shop, Cart\./);
    expect((await sh('product', 'features', 'web', '--remove', 'Nope')).err).toMatch(/does not select Nope/);
    const bad = await sh('product', 'features', 'web', '--add', 'Ghost');
    expect(bad.code).toBe(1);
    expect((await sh('product', 'features', 'web')).out).not.toMatch(/Ghost/);

    // from inside the product, with no name
    process.chdir(path.join(line, 'web'));
    expect((await sh('product', 'features')).out).toMatch(/web selects 2 feature/);
  });
});
});
