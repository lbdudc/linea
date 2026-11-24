import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn , setDefaultTimeout } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildLineScaffold } from '@lbdudc/linea-core';
import { GitLabProvider } from '@lbdudc/linea-git';
import { answer, credentialHelper, parseRequest } from '../src/core/credentialHelper.js';
import { clearAuth, loadState } from '../src/core/credentials.js';
import { gitSettings } from '../src/core/git.js';
import { cloneUrlOf, configureCredentials, helperCommand, readOrigin, slug } from '../src/core/gitops.js';
import { getCommand } from '../src/commands/registry.js';
import { withFeatureMetamodel } from './helpers.js';
import type { CommandContext, Session } from '../src/commands/types.js';
import { runShell } from '../src/shell.js';

// `linea clone / status / pull / push` against real git: the remotes are bare repositories on disk, the server and the host API are stubbed.

// real git, one process per call: slow on some machines
setDefaultTimeout(60_000);

const ENV = ['LINEA_HOME', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_PROVIDER', 'GITLAB_HOSTNAME', 'GITLAB_TOKEN', 'GITHUB_TOKEN', 'LINEA_GIT_TOKEN'];
const saved: Record<string, string | undefined> = {};
const cwd0 = process.cwd();
const realFetch = globalThis.fetch;
let tmp: string;

beforeAll(() => {
  for (const k of ENV) saved[k] = process.env[k];
});
afterAll(() => {
  for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});

const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

/** A bare repository `<tmp>/remote/<name>.git` with one commit of these files on `main`, and the address the host would show for it. */
function remote(name: string, files: Record<string, string>): { bare: string; webUrl: string } {
  const bare = path.join(tmp, 'remote', `${name}.git`);
  fs.mkdirSync(bare, { recursive: true });
  git(bare, 'init', '--bare', '--quiet', '-b', 'main');
  const seed = path.join(tmp, 'seed', name);
  fs.mkdirSync(seed, { recursive: true });
  git(seed, 'init', '--quiet', '-b', 'main');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(seed, file)), { recursive: true });
    fs.writeFileSync(path.join(seed, file), content);
  }
  git(seed, 'add', '-A');
  git(seed, 'commit', '--quiet', '-m', 'first');
  git(seed, 'push', '--quiet', pathToFileURL(bare).href, 'HEAD:refs/heads/main');
  return { bare, webUrl: pathToFileURL(path.join(tmp, 'remote', name)).href };
}

/** The files of an SPL "gis" as the server keeps it now: spl.json (its kind and what it asks for) and its feature model, the products' index. */
const lineFiles = (kind: 'plain' | 'modular' = 'modular', extra: Record<string, string> = {}): Record<string, string> => ({
  ...Object.fromEntries(buildLineScaffold({ name: 'gis', kind, featureMetamodel: 'file:metamodels/featuremodel', ci: 'gitlab' }).map((f) => [f.path, f.content])),
  'products.json': '{"productos":[]}',
  ...extra,
});

const branches = (bare: string): string[] => git(bare, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean);

let server: Record<string, unknown>;
let requests: { method: string; path: string; body: unknown }[];
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linea-bridge-')));
  process.env['LINEA_HOME'] = path.join(tmp, 'home');
  fs.mkdirSync(path.join(process.env['LINEA_HOME'], '.linea'), { recursive: true });
  fs.writeFileSync(path.join(process.env['LINEA_HOME'], '.linea', 'credentials.json'), JSON.stringify({ token: 'jwt', user: { userId: '1', username: 'ana' }, workdir: path.join(tmp, 'ws') }));
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Ana', GIT_AUTHOR_EMAIL: 'ana@example.com', GIT_COMMITTER_NAME: 'Ana', GIT_COMMITTER_EMAIL: 'ana@example.com' });
  Object.assign(process.env, { GIT_PROVIDER: 'gitlab', GITLAB_HOSTNAME: 'http://gitlab.test', GITLAB_TOKEN: 'glpat-test' });
  // the workspace holds the feature metamodel every SPL is made of
  fs.mkdirSync(path.join(tmp, 'ws'), { recursive: true });
  withFeatureMetamodel(path.join(tmp, 'ws'));
  server = {};
  requests = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const pathname = new URL(String(input)).pathname;
    requests.push({ method: init?.method ?? 'GET', path: pathname, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    const body = server[pathname];
    return body === undefined
      ? new Response(JSON.stringify({ message: `no ${pathname}` }), { status: 404 })
      : new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.chdir(cwd0);
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

/** An SPL "gis" with a product "shop" on the host, as the server describes them. */
function publishLine(opts: { spl?: Record<string, string> } = {}) {
  const spl = remote('gis', opts.spl ?? lineFiles());
  const shop = remote('shop', { '.linea/spec.json': '{"basicData":{"name":"shop","version":"0.0.0"},"features":["Gis"]}', '.linea/models/featureselection.featureselection': 'selection of Gis {\n}\n', 'README.md': '# shop\n' });
  server['/api/lines/enrolled'] = [{ _id: 'line1', name: 'gis', version: '1.0.0' }];
  server['/api/lines/line1'] = {
    _id: 'line1', name: 'gis', version: '1.0.0', description: '', models: [], repoId: 11, namespaceId: 1,
    webUrl: spl.webUrl, webIdeUrl: '', members: [],
    products: [{ _id: 'prod1', name: 'shop', version: '0.0.0', line: 'gis', createdAt: '', repo: { id: 22, webUrl: shop.webUrl } }],
  };
  server['/api/users/config'] = { primary: 'gitlab', hosts: [{ id: 'gitlab', redirectUri: 'http://localhost:9000/login', clientId: 'x', url: 'http://gitlab.test' }] };
  return { spl, shop };
}

describe('clone', () => {
  it('clones the SPL and its products as repositories, and remembers where they came from', async () => {
    publishLine();
    const r = await sh('get', 'gis');
    expect(r.err.replace(/^[●◐○] .*\n/, '')).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/✓ gis/);
    expect(r.out).toMatch(/✓ shop .*\(product\)/);

    const ws = path.join(tmp, 'ws');
    expect(fs.existsSync(path.join(ws, 'gis', '.git'))).toBe(true);
    expect(fs.existsSync(path.join(ws, 'gis', 'shop', '.git'))).toBe(true);
    expect(readOrigin(path.join(ws, 'gis'))).toMatchObject({ kind: 'spl', lineId: 'line1', projectId: 11, defaultBranch: 'main', webUi: 'http://localhost:9000' });
    expect(readOrigin(path.join(ws, 'gis', 'shop'))).toMatchObject({ kind: 'product', productId: 'prod1', projectId: 22 });

    // what is local to the checkout stays out of the repositories: the origin files, and the product inside the SPL's folder
    expect(git(path.join(ws, 'gis'), 'status', '--porcelain').trim()).toBe('');
    expect(git(path.join(ws, 'gis', 'shop'), 'status', '--porcelain').trim()).toBe('');

    // asking for what is here updates it
    expect((await sh('get', 'gis')).out).toMatch(/already up to date/);
  });

  it('clones one product, or none, and says which products do not exist', async () => {
    publishLine();
    const none = await sh('get', 'gis', '--products', 'none');
    expect(none.out).toMatch(/1 product\(s\) not cloned/);
    expect(fs.existsSync(path.join(tmp, 'ws', 'gis', 'shop'))).toBe(false);
    expect((await sh('get', 'gis:shop')).out).toMatch(/✓ shop/);
    expect(fs.existsSync(path.join(tmp, 'ws', 'gis', 'shop', '.git'))).toBe(true);
    const bad = await sh('get', 'gis:nope');
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/has no product "nope"/);
  });

  it('refuses when signed out or when the SPL is not yours', async () => {
    publishLine();
    expect((await sh('get', 'other')).err).toMatch(/No SPL matching "other"/);
    expect((await sh('clone')).code).toBe(2);
  });
});

describe('get does not hold everything up', () => {
  it('lets the event loop run while it clones (the window keeps drawing), and says what it is doing as it goes', async () => {
    publishLine();
    const events: string[] = [];
    // a timer that is due at once: a clone that blocks would let it fire only when everything is done
    setTimeout(() => events.push('tick'), 0);
    const session: Session = { baseUrl: 'http://unused.invalid', authed: true, workdir: path.join(tmp, 'ws'), cwd: tmp };
    const ctx: CommandContext = {
      args: ['gis'], rest: 'gis', session,
      updateSession: (p) => Object.assign(session, p),
      setStatus: (m) => { if (m) events.push(`status: ${m}`); },
      print: () => {}, clear: () => {}, exit: () => {},
    };
    const out = String(await getCommand('get')!.run(ctx));
    events.push('done');

    expect(out).toMatch(/✓ gis/);
    expect(events.indexOf('tick')).toBeGreaterThan(-1);
    expect(events.indexOf('tick')).toBeLessThan(events.indexOf('done'));
    // which of the clones it is on, out of how many
    const said = events.filter((e) => e.startsWith('status: '));
    expect(said.some((e) => /cloning gis \(1 of 2\)/.test(e))).toBe(true);
    expect(said.some((e) => /cloning product shop \(2 of 2\)/.test(e))).toBe(true);
  });
});

describe('status, push and pull', () => {
  it('sends changes on a branch, with a merge request, and not on the default branch', async () => {
    const { spl } = publishLine();
    await sh('get', 'gis');
    const lineDir = path.join(tmp, 'ws', 'gis');
    process.chdir(lineDir);

    expect((await sh('status')).out).toMatch(/gis\s+spl\s+main\s+in sync\s+clean/);
    fs.writeFileSync(path.join(lineDir, 'NOTES.md'), 'hello\n');
    fs.writeFileSync(path.join(lineDir, 'models', 'featuremodel.featuremodel'), 'featuremodel Gis feature Gis {\n  optional {\n    feature Extra\n  }\n}\n');
    const status = await sh('status');
    expect(status.out).toMatch(/2 changed \(1 new\)/);
    expect(status.out).toMatch(/Next: push/);

    const request = spyOn(GitLabProvider.prototype, 'createOrRenameChangeRequest').mockResolvedValue({
      number: 7, webUrl: 'http://gitlab.test/g/gis/-/merge_requests/7', title: 'x', state: 'opened', sourceBranch: 'b', targetBranch: 'main',
    } as never);
    try {
      const pushed = await sh('push', '-m', 'Add an extra feature');
      expect(pushed.err.replace(/^[●◐○] .*\n/, '')).toBe('');
      expect(pushed.code).toBe(0);
      expect(pushed.out).toMatch(/✓ gis: pushed linea\/ana\/add-an-extra-feature-\d+ → http:\/\/gitlab\.test\/g\/gis\/-\/merge_requests\/7/);

      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0]![0]).toMatchObject({ token: 'glpat-test', id: 11, title: 'Add an extra feature', targetBranch: 'main' });

      // the host has the branch, the default branch is untouched, and a second push has nothing to send
      expect(branches(spl.bare).some((b) => b.startsWith('linea/ana/add-an-extra-feature-'))).toBe(true);
      expect(git(spl.bare, 'log', '--format=%s', 'main').trim()).toBe('first');
      expect(git(spl.bare, 'log', '--format=%s', branches(spl.bare).find((b) => b.startsWith('linea/'))!).split('\n')[0]).toBe('Add an extra feature');
      expect((await sh('push')).out).toMatch(/Nothing to push/);
    } finally {
      request.mockRestore();
    }
  });

  it('--direct pushes to the default branch and opens nothing', async () => {
    const { spl } = publishLine();
    await sh('get', 'gis');
    const lineDir = path.join(tmp, 'ws', 'gis');
    process.chdir(lineDir);
    fs.writeFileSync(path.join(lineDir, 'NOTES.md'), 'direct\n');
    const request = spyOn(GitLabProvider.prototype, 'createOrRenameChangeRequest');
    try {
      const r = await sh('push', '--direct', '-m', 'Straight in');
      expect(r.out).toMatch(/✓ gis: pushed to main/);
      expect(request).not.toHaveBeenCalled();
      expect(git(spl.bare, 'log', '--format=%s', 'main').split('\n')[0]).toBe('Straight in');
    } finally {
      request.mockRestore();
    }
  });

  it('a product is pushed on its own from inside it, with its own project', async () => {
    const { shop } = publishLine();
    await sh('get', 'gis');
    const productDir = path.join(tmp, 'ws', 'gis', 'shop');
    process.chdir(productDir);
    fs.writeFileSync(path.join(productDir, 'README.md'), '# shop, changed\n');
    const request = spyOn(GitLabProvider.prototype, 'createOrRenameChangeRequest').mockResolvedValue({ number: 1, webUrl: 'http://gitlab.test/mr/1' } as never);
    try {
      const r = await sh('push', '-m', 'Docs');
      expect(r.out).toMatch(/✓ shop: pushed linea\/ana\/docs-/);
      expect(request.mock.calls[0]![0]).toMatchObject({ id: 22 });
      expect(branches(shop.bare).some((b) => b.startsWith('linea/ana/docs-'))).toBe(true);
    } finally {
      request.mockRestore();
    }
  });

  it('does not send the cache that checking leaves in the SPL', async () => {
    publishLine({
      spl: lineFiles(),
    });
    await sh('get', 'gis', '--products', 'none');
    const lineDir = path.join(tmp, 'ws', 'gis');
    process.chdir(lineDir);
    expect((await sh('check')).out).toMatch(/✓ The modules fit together/);
    expect(fs.existsSync(path.join(lineDir, '.linea', 'composed-model.uvl'))).toBe(true);
    // checking made a file, and git does not see it
    expect(git(lineDir, 'status', '--porcelain').trim()).toBe('');
  });

  it('does not send a SPL whose modules do not check out, unless told to', async () => {
    const { spl } = publishLine({
      spl: lineFiles(),
    });
    await sh('get', 'gis', '--products', 'none');
    const lineDir = path.join(tmp, 'ws', 'gis');
    process.chdir(lineDir);
    // a module that is nowhere
    const manifest = JSON.parse(fs.readFileSync(path.join(lineDir, 'spl.json'), 'utf8'));
    fs.writeFileSync(path.join(lineDir, 'spl.json'), JSON.stringify({ ...manifest, modules: { 'file:modules/ghost': '^1.0.0' } }));

    const request = spyOn(GitLabProvider.prototype, 'createOrRenameChangeRequest').mockResolvedValue({ number: 1, webUrl: 'http://gitlab.test/mr/1' } as never);
    try {
      const blocked = await sh('push', '-m', 'Add ghost');
      expect(blocked.out).toMatch(/✗ gis: not sent, it does not check out/);
      expect(blocked.code).toBe(1);
      expect(branches(spl.bare)).toEqual(['main']);

      const forced = await sh('push', '-m', 'Add ghost', '--no-check');
      expect(forced.code).toBe(0);
      expect(branches(spl.bare).length).toBe(2);
    } finally {
      request.mockRestore();
    }
  });

  it('pull brings what changed on the host, and says when it cannot go forward', async () => {
    const { spl } = publishLine();
    await sh('get', 'gis', '--products', 'none');
    const lineDir = path.join(tmp, 'ws', 'gis');
    process.chdir(lineDir);
    expect((await sh('get')).out).toMatch(/already up to date/);

    // somebody else pushes
    const other = path.join(tmp, 'other');
    git(tmp, 'clone', '--quiet', pathToFileURL(spl.bare).href, other);
    fs.writeFileSync(path.join(other, 'THEIRS.md'), 'x\n');
    git(other, 'add', '-A');
    git(other, 'commit', '--quiet', '-m', 'theirs');
    git(other, 'push', '--quiet', 'origin', 'HEAD:main');

    expect((await sh('status', '--fetch')).out).toMatch(/↓1/);
    const pulled = await sh('get');
    expect(pulled.out).toMatch(/✓ gis: updated \(1 new commit/);
    expect(fs.existsSync(path.join(lineDir, 'THEIRS.md'))).toBe(true);

    // now both moved: no merge is made for you
    fs.writeFileSync(path.join(lineDir, 'MINE.md'), 'y\n');
    git(lineDir, 'add', '-A');
    git(lineDir, 'commit', '--quiet', '-m', 'mine');
    fs.writeFileSync(path.join(other, 'THEIRS2.md'), 'x\n');
    git(other, 'add', '-A');
    git(other, 'commit', '--quiet', '-m', 'theirs 2');
    git(other, 'push', '--quiet', 'origin', 'HEAD:main');
    const diverged = await sh('get');
    expect(diverged.out).toMatch(/✗ gis:/);
  });

  it('status from the workspace lists the SPLs, and says when there is none', async () => {
    publishLine();
    process.chdir(tmp);
    expect((await sh('status')).out).toMatch(/No SPL checkouts here/);
    await sh('get', 'gis');
    process.chdir(path.join(tmp, 'ws'));
    const r = await sh('status', '--json');
    expect(JSON.parse(r.out)).toMatchObject([{ name: 'gis', kind: 'spl', branch: 'main' }]);
  });
});

describe('link', () => {
  /** What the host has after the server made a line: a repository with the scaffold. */
  const scaffold = (name: string) => {
    const made = remote(name, { 'README.md': `# ${name}\n`, 'products.json': '{"productos":[]}' });
    server['/api/lines'] = { _id: 'line9', name, repoId: 9, webUrl: made.webUrl };
    server['/api/users/config'] = { primary: 'gitlab', hosts: [{ id: 'gitlab', redirectUri: 'http://localhost:9000/login' }] };
    return made;
  };

  it('uploads an SPL made here and makes the folder its checkout, leaving the products where they are', async () => {
    const made = scaffold('mine');
    fs.mkdirSync(path.join(tmp, 'ws'), { recursive: true });
    process.chdir(path.join(tmp, 'ws'));
    expect((await sh('spl', 'new', 'mine', '--plain', '--local')).code).toBe(0);
    const lineDir = path.join(tmp, 'ws', 'mine');
    process.chdir(lineDir);
    expect((await sh('product', 'new', 'local-product')).code).toBe(0);

    const r = await sh('push');
    expect(r.err.replace(/^[●◐○] .*\n/, '')).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/✓ mine is on LINEA/);
    expect(r.out).toMatch(/products stay here/);

    // the host has the local platform on top of its scaffold, and not the product
    const files = git(made.bare, 'ls-tree', '-r', '--name-only', 'main').split('\n');
    expect(files).toContain('README.md');
    expect(files.some((f) => f.startsWith('src/platform/'))).toBe(true);
    expect(files.some((f) => f.includes('local-product'))).toBe(false);
    expect(git(made.bare, 'log', '--format=%s', 'main').split('\n')[0]).toBe('Upload mine from the command line');

    // the folder is the checkout: a repository, in step with the host, with where it came from
    expect(git(lineDir, 'status', '--porcelain').trim()).toBe('');
    expect(readOrigin(lineDir)).toMatchObject({ kind: 'spl', lineId: 'line9', projectId: 9, defaultBranch: 'main' });
    expect((await sh('status')).out).toMatch(/mine\s+spl\s+main\s+in sync\s+clean/);
    expect((await sh('push')).out).toMatch(/Nothing to push/);
  });

  it('does not upload an SPL that uses modules the host does not have', async () => {
    scaffold('gis');
    process.chdir(tmp);
    fs.mkdirSync(path.join(tmp, 'gis'));
    fs.writeFileSync(path.join(tmp, 'gis', 'spl.json'), JSON.stringify({ name: 'gis', version: '1.0.0', modules: { 'file:modules/draw': '^0.1.0' } }));
    fs.mkdirSync(path.join(tmp, 'gis', 'src', 'platform'), { recursive: true });
    process.chdir(path.join(tmp, 'gis'));
    const r = await sh('push');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/file:modules\/draw is only in your workspace: publish it first/);
  });
});

describe('one step each way', () => {
  it('spl new, signed in, makes the SPL on LINEA and brings it to the folder', async () => {
    const made = remote('fresh', { 'README.md': '# fresh\n', 'spl.json': '{"name":"fresh","version":"1.0.0","modules":{}}', 'src/platform/model.uvl': 'features\n\tFresh\n' });
    server['/api/lines'] = { _id: 'line7', name: 'fresh', repoId: 7, webUrl: made.webUrl };
    server['/api/lines/enrolled'] = [{ _id: 'line7', name: 'fresh', version: '1.0.0' }];
    server['/api/lines/line7'] = { _id: 'line7', name: 'fresh', version: '1.0.0', repoId: 7, webUrl: made.webUrl, products: [] };
    server['/api/users/config'] = { primary: 'gitlab', hosts: [{ id: 'gitlab', redirectUri: 'http://localhost:9000/login' }] };

    const r = await sh('spl', 'new', 'fresh', '--modules', 'gitlab:registry/modules/draw');
    expect(r.err.replace(/^[●◐○] .*\n/, '')).toBe('');
    expect(r.code).toBe(0);
    // one command: it was made on LINEA (a modular SPL, with the module asked for), and it is here as a clone
    const created = requests.find((q) => q.method === 'POST' && q.path === '/api/lines')!;
    expect(created.body).toMatchObject({ name: 'fresh', modular: true, modules: { 'gitlab:registry/modules/draw': '*' } });
    expect(readOrigin(path.join(tmp, 'ws', 'fresh'))).toMatchObject({ kind: 'spl', lineId: 'line7' });
    expect(r.out).toMatch(/✓ fresh/);
  });

  it('spl new with --local, or with a module only this machine has, stays here, or says what to do', async () => {
    const local = await sh('spl', 'new', 'mine', '--local');
    expect(local.code).toBe(0);
    expect(requests.some((q) => q.method === 'POST')).toBe(false);
    expect(local.out).toMatch(/Created/);

    const refused = await sh('spl', 'new', 'other', '--modules', 'draw');
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/Publish them .* or make the SPL here with --local/);
    expect(requests.some((q) => q.method === 'POST')).toBe(false);
  });

  it('spl list puts the SPLs of this machine and of LINEA side by side', async () => {
    publishLine();
    server['/api/lines/enrolled'] = [
      { _id: 'line1', name: 'gis', version: '1.0.0' },
      { _id: 'line5', name: 'elsewhere', version: '2.0.0' },
    ];
    await sh('get', 'gis', '--products', 'none');
    expect((await sh('spl', 'new', 'only-here', '--local')).code).toBe(0);

    const list = await sh('spl', 'list');
    expect(list.out).toMatch(/gis\s+here \+ LINEA\s+v1\.0\.0/);
    expect(list.out).toMatch(/only-here\s+here only .*\(push uploads it\)/);
    expect(list.out).toMatch(/elsewhere\s+LINEA only\s+v2\.0\.0.*\(get elsewhere\)/);

    // --local does not ask the server
    requests.length = 0;
    const offline = await sh('spl', 'list', '--local');
    expect(requests).toEqual([]);
    expect(offline.out).not.toMatch(/elsewhere/);

    expect(JSON.parse((await sh('spl', 'list', '--json')).out).map((r: { name: string }) => r.name)).toEqual(['elsewhere', 'gis', 'only-here']);
  });

  it('spl list says so when LINEA does not answer', async () => {
    delete server['/api/lines/enrolled'];
    const r = await sh('spl', 'list');
    expect(r.out).toMatch(/LINEA did not answer/);
  });

  it('product new, in an SPL that is on LINEA, makes the product there and brings it into the folder', async () => {
    publishLine();
    await sh('get', 'gis', '--products', 'none');
    const lineDir = path.join(tmp, 'ws', 'gis');
    process.chdir(lineDir);

    const made = remote('web', { '.linea/spec.json': '{"basicData":{"name":"web","version":"0.0.0"},"features":["Gis"]}' });
    server['/api/products'] = { _id: 'prod9', spec: { basicData: { name: 'web', version: '0.0.0' }, features: ['Gis'] }, repo: { id: 33, webUrl: made.webUrl } };
    const r = await sh('product', 'new', 'web', '--features', 'Gis');
    expect(r.err.replace(/^[●◐○] .*\n/, '')).toBe('');
    expect(r.out).toMatch(/✓ Created web on LINEA, and it is here/);
    expect(requests.find((q) => q.method === 'POST' && q.path === '/api/products')!.body).toMatchObject({ lineId: 'line1', spec: { basicData: { name: 'web' }, features: ['Gis'] } });
    expect(readOrigin(path.join(lineDir, 'web'))).toMatchObject({ kind: 'product', productId: 'prod9', projectId: 33 });
    // it is a repository of its own that the SPL's git leaves alone, so one push sends each where it belongs
    expect(git(lineDir, 'status', '--porcelain').trim()).toBe('');
  });

  it('push of an SPL that is only here uploads it; with --local it says what to do', async () => {
    const made = remote('draft', { 'README.md': '# draft\n' });
    server['/api/lines'] = { _id: 'line3', name: 'draft', repoId: 3, webUrl: made.webUrl };
    server['/api/users/config'] = { primary: 'gitlab', hosts: [{ id: 'gitlab', redirectUri: 'http://localhost:9000/login' }] };
    fs.mkdirSync(path.join(tmp, 'ws'), { recursive: true });
    process.chdir(path.join(tmp, 'ws'));
    expect((await sh('spl', 'new', 'draft', '--local', '--plain')).code).toBe(0);
    process.chdir(path.join(tmp, 'ws', 'draft'));

    const refused = await sh('push', '--local');
    expect(refused.out).toMatch(/draft is only on this machine/);
    expect(requests.some((q) => q.method === 'POST')).toBe(false);

    const sent = await sh('push');
    expect(sent.out).toMatch(/✓ draft is on LINEA/);
    expect(readOrigin(path.join(tmp, 'ws', 'draft'))).toMatchObject({ lineId: 'line3' });
  });

  it('get with no name updates the SPLs you have (the one you are in, else those of the workspace); with none, it lists what there is', async () => {
    publishLine();
    // nothing here yet: it says what there is to get
    expect((await sh('get')).out).toMatch(/Get one with: get <name>/);

    await sh('get', 'gis', '--products', 'none');
    process.chdir(path.join(tmp, 'ws', 'gis'));
    expect((await sh('get')).out).toMatch(/gis: already up to date/);
    process.chdir(tmp);
    expect((await sh('get')).out).toMatch(/gis: already up to date/);
  });
});

describe('web and repo', () => {
  it('say where the SPL and its products are, from where they were cloned', async () => {
    const { spl } = publishLine();
    await sh('get', 'gis');
    process.chdir(path.join(tmp, 'ws', 'gis'));
    expect((await sh('open', '--web', '--print')).out.trim()).toBe('http://localhost:9000/lines/line1');
    expect((await sh('open', 'shop', '--web', '--print')).out.trim()).toBe('http://localhost:9000/products/prod1');
    expect((await sh('open', '--repo', '--print')).out.trim()).toBe(spl.webUrl);
    process.chdir(path.join(tmp, 'ws', 'gis', 'shop'));
    expect((await sh('open', '--web', '--print')).out.trim()).toBe('http://localhost:9000/products/prod1');
    process.chdir(tmp);
    expect((await sh('open', '--web', '--print')).err).toMatch(/cloned from LINEA/);
  });
});

describe('git credentials', () => {
  it('the helper answers git for the host linea is set up for, and for nobody else', () => {
    const gitlab = { config: { provider: 'gitlab' as const, gitlab: { url: 'https://gitlab.example.com' } }, token: 'T' };
    const ask = (fields: string) => answer(fields, gitlab as never);
    expect(ask('protocol=https\nhost=gitlab.example.com\npath=g/p.git\n')).toBe('username=oauth2\npassword=T\n');
    expect(ask('protocol=https\nhost=evil.example.com\n')).toBe('');
    expect(ask('protocol=http\nhost=gitlab.example.com\n')).toBe('');
    expect(ask('protocol=https\n')).toBe('');

    const github = { config: { provider: 'github' as const, github: {} }, token: 'G' };
    expect(answer('protocol=https\nhost=github.com\n', github as never)).toBe('username=x-access-token\npassword=G\n');
    expect(parseRequest('a=1\nb=two=2\n')).toEqual({ a: '1', b: 'two=2' });
  });

  it('says nothing for store/erase, or when linea has no credentials', () => {
    expect(credentialHelper('store', 'host=x\n', () => { throw new Error('x'); })).toBe('');
    expect(credentialHelper('get', 'host=gitlab.example.com\n', () => { throw new Error('no token'); })).toBe('');
  });

  it('a clone is set up so plain git finds the token: the helper is configured for the host, after an empty one', () => {
    const dir = path.join(tmp, 'repo');
    fs.mkdirSync(dir);
    git(dir, 'init', '--quiet');
    configureCredentials(dir, 'https://gitlab.example.com/g/p.git');
    const helpers = git(dir, 'config', '--local', '--get-all', 'credential.https://gitlab.example.com.helper').split('\n').filter((_, i, all) => i < all.length - 1);
    expect(helpers[0]).toBe('');
    expect(helpers[1]).toBe(helperCommand());
    expect(helperCommand()).toMatch(/^!'[^']+'( '--no-env-file' '[^']+')? 'credential'$/);
    // for a file or an unknown scheme there is nothing to configure
    configureCredentials(dir, pathToFileURL(dir).href);
    expect(git(dir, 'config', '--local', '--list')).not.toMatch(/file:/);
  });

  it('what login stored is used when the environment has no token, and the environment wins when it has one', () => {
    for (const k of ['GIT_PROVIDER', 'GITLAB_HOSTNAME', 'GITLAB_TOKEN', 'GITHUB_TOKEN', 'LINEA_GIT_TOKEN']) delete process.env[k];
    const stored = { server: 'http://srv.test', source: 'server' as const, provider: 'github' as const, host: { webUrl: 'https://ghe.example.com', apiUrl: 'https://ghe.example.com/api/v3' }, username: 'ana', token: 'gho_stored' };
    const fromStore = gitSettings(process.env, stored);
    expect(fromStore.token).toBe('gho_stored');
    expect(fromStore.config.provider).toBe('github');
    expect(fromStore.config.github?.apiUrl).toBe('https://ghe.example.com/api/v3');

    expect(() => gitSettings(process.env, undefined)).toThrow(/GITLAB_HOSTNAME/);
    process.env['LINEA_GIT_TOKEN'] = 'env-token';
    process.env['GIT_PROVIDER'] = 'github';
    expect(gitSettings(process.env, stored).token).toBe('env-token');
  });

  it('login keeps the git access the server gives, and logout drops it', async () => {
    server['/api/users/git-credentials'] = { provider: 'github', host: { webUrl: 'https://ghe.test', apiUrl: 'https://ghe.test/api/v3' }, username: 'ana', token: 'gho_abc' };
    const { storeGitCredentials } = await import('../src/commands/auth.js');
    expect(await storeGitCredentials('http://srv.test')).toBe('GitHub');
    expect(loadState().git).toMatchObject({ provider: 'github', token: 'gho_abc' });

    clearAuth();
    expect(loadState().git).toBeUndefined();
    delete server['/api/users/git-credentials'];
    expect(await storeGitCredentials('http://srv.test')).toBeUndefined(); // the server has none: nothing is kept
    expect(loadState().git).toBeUndefined();
  });

  it('knows the address git clones from and a branch-name word', () => {
    expect(cloneUrlOf('https://gitlab.example.com/g/p')).toBe('https://gitlab.example.com/g/p.git');
    expect(cloneUrlOf('https://gitlab.example.com/g/p.git/')).toBe('https://gitlab.example.com/g/p.git');
    expect(slug('Add: a *New* feature!!')).toBe('add-a-new-feature');
    expect(slug('///')).toBe('changes');
  });
});
