import { describe, it, expect } from 'vitest';
import { createRoutingSource, resolveSpl } from '@lbdudc/linea-core';
import { GitHubClient, GitHubPackageSource, discoverGitHubPackages } from '../src/index.js';

const isGitHubLocation = (location: string): boolean => /^github:[^/]+\/[^/]+$/.test(location);

/** A GitHub made of a few repositories: { 'owner/repo': { 'v1.0.0': { path: content } } }, answering the REST calls linea makes. */
interface FakeRepo { topics?: string[], description?: string, versions: Record<string, Record<string, string>> }
type Call = { pathname: string, headers: Record<string, string> }

const fakeGitHub = (repos: Record<string, FakeRepo>, calls: Call[] = []): any => async (url: string, { headers = {} }: { headers?: Record<string, string> } = {}) => {
  const { pathname, searchParams } = new URL(url);
  calls.push({ pathname, headers });
  const json = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body });
  const missing = { ok: false, status: 404, headers: new Headers(), text: async () => '{}', json: async () => ({}) };
  const search = /^\/search\/repositories$/.exec(pathname);
  if (search) {
    const [, topic = '', owner = ''] = /topic:(\S+) user:(\S+)/.exec(searchParams.get('q') ?? '') ?? [];
    const items = Object.entries(repos)
      .filter(([full, repo]) => full.startsWith(`${owner}/`) && repo.topics?.includes(topic))
      .map(([full, repo]) => ({ full_name: full, name: full.split('/')[1], description: repo.description ?? '', html_url: `https://github.com/${full}` }));
    return json({ items });
  }
  const match = /^\/repos\/([^/]+\/[^/]+)\/(tags|git\/trees\/[^/]+|commits\/[^/]+|contents\/.+)$/.exec(pathname);
  if (!match) return missing;
  const [, full = '', rest = ''] = match;
  const repo = repos[full];
  if (!repo) return missing;
  if (rest === 'tags') return json(Object.keys(repo.versions).map((name) => ({ name })));
  const ref = decodeURIComponent(searchParams.get('ref') ?? rest.split('/')[2] ?? '');
  const files = repo.versions[ref];
  if (rest.startsWith('git/trees/')) {
    const tree = repo.versions[decodeURIComponent(rest.split('/')[2] ?? '')];
    return tree ? json({ tree: Object.keys(tree).map((path) => ({ type: 'blob', path })) }) : missing;
  }
  if (rest.startsWith('commits/')) return json({ sha: `sha-${decodeURIComponent(rest.split('/')[1] ?? '')}` });
  const path = decodeURIComponent(rest.slice('contents/'.length));
  if (!files || files[path] === undefined) return missing;
  const bytes = new TextEncoder().encode(files[path]);
  return { ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};

const manifest = (value: unknown) => JSON.stringify(value);
const REPOS = {
  'acme/core': {
    topics: ['linea-module'],
    description: 'The core',
    versions: {
      'v1.0.0': {
        '.linea/module.json': manifest({ name: 'core', version: '1.0.0', requires: { modules: {}, metamodels: { '../basic': '^1.0.0' } }, offers: {} }),
        '.linea/model.uvl': 'features\n\tCore\n\t\toptional\n\t\t\tAudit\n',
      },
      'not-a-version': {},
    },
  },
  'acme/basic': {
    topics: ['linea-metamodel'],
    versions: {
      'v1.0.0': {
        'metamodel.json': manifest({ name: 'basic', version: '1.0.0', requires: {} }),
        'basic.langium': "grammar Basic\n\nentry BasicModel: 'basic' name=ID?;\n\nterminal ID: /[_a-zA-Z][\\w_-]*/;\nhidden terminal WS: /\\s+/;\n",
      },
    },
  },
};

const API = 'https://api.github.com';
const clientOf = (calls?: any[]) => new GitHubClient({ apiUrl: API, fetchImpl: fakeGitHub(REPOS, calls) });
const source = (calls?: any[]) => new GitHubPackageSource({ userId: 'u', token: 't0k', client: clientOf(calls), allowedOwners: [] });

describe('GitHubPackageSource', () => {
  it('knows its locations', () => {
    expect(isGitHubLocation('github:acme/core')).toBe(true);
    expect(isGitHubLocation('github:acme')).toBe(false);
    expect(isGitHubLocation('gitlab:acme/core')).toBe(false);
  });

  it('lists the versions from the tags that look like one', async () => {
    expect(await source().listVersions({ location: 'github:acme/core' })).toEqual(['1.0.0']);
    expect(await source().listVersions({ location: 'github:acme/ghost' })).toEqual([]);
  });

  it('opens the files of a version, and says which commit it is', async () => {
    const s = source();
    await s.listVersions({ location: 'github:acme/core' });
    const files = await s.open({ location: 'github:acme/core', version: '1.0.0' });
    expect(await files.list({ dir: '' })).toEqual(['.linea/module.json', '.linea/model.uvl']);
    expect(new TextDecoder().decode(await files.read({ path: '.linea/model.uvl' }))).toContain('Audit');
    expect(await files.read({ path: 'nothing.txt' })).toBeUndefined();
    expect(await s.revision({ location: 'github:acme/core', version: '1.0.0' })).toBe('sha-v1.0.0');
  });

  it('sends the token when it has one', async () => {
    const calls: Call[] = [];
    await source(calls).listVersions({ location: 'github:acme/core' });
    expect(calls[0]?.headers.Authorization).toBe('Bearer t0k');
  });

  it('only reads from the owners it trusts', async () => {
    const guarded = new GitHubPackageSource({ userId: 'u', client: clientOf(), allowedOwners: ['other'] });
    await expect(guarded.listVersions({ location: 'github:acme/core' })).rejects.toThrow(/outside the trusted namespaces/);
    const none = new GitHubPackageSource({ userId: 'u', client: clientOf(), allowedOwners: null });
    await expect(none.listVersions({ location: 'github:acme/core' })).rejects.toThrow(/outside the trusted namespaces/);
  });

  it('refuses a location that is not a GitHub one', async () => {
    await expect(source().listVersions({ location: 'gitlab:acme/core' })).rejects.toThrow(/not a GitHub location/);
  });
});

describe('packages on GitHub', () => {
  it('are found by their topic', async () => {
    const client = clientOf();
    const found = await discoverGitHubPackages({ topic: 'linea-module', owners: ['acme'], source: source(), client });
    expect(found.map((f) => [f.location, f.versions])).toEqual([['github:acme/core', ['1.0.0']]]);
  });

  it('are resolved by linea-core like any other, a module requiring its sibling metamodel by ../', async () => {
    const resolved = await resolveSpl({ spl: { name: 'shop', kind: 'modular', metamodels: {}, modules: { 'github:acme/core': '^1.0.0' } }, source: createRoutingSource({ sources: { github: source() } }) });
    expect(resolved.modules.map((m) => m.location)).toEqual(['github:acme/core']);
    expect(resolved.metamodels.map((m) => m.location)).toEqual(['github:acme/basic']);
    expect(resolved.lock.packages['github:acme/core']?.revision).toBe('sha-v1.0.0');
  });
});
