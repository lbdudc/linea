import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient, GitHubProvider, GitLabProvider, clearGitHubCache, type GitProvider } from '../src/index.js';
import { startGithubDouble, startGitlabDouble } from '../src/testing/index.js';

// `git clone / pull / push` against the in-memory hosts, with real git: what the CLI does against them on a laptop.

// real git, one process per call: slow on some machines
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const token = 'tok';
const GIT_ENV = { GIT_AUTHOR_NAME: 'Ana', GIT_AUTHOR_EMAIL: 'ana@example.com', GIT_COMMITTER_NAME: 'Ana', GIT_COMMITTER_EMAIL: 'ana@example.com', GIT_TERMINAL_PROMPT: '0' };

// asynchronous on purpose: the host being talked to runs in this very process, and a blocked event loop cannot answer
const git = (cwd: string, ...args: string[]): Promise<{ status: number; out: string; err: string }> =>
  new Promise((resolve) => {
    execFile('git', ['-c', 'core.autocrlf=false', '-c', 'credential.helper=', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV }, maxBuffer: 64 * 1024 * 1024 }, (error, out, err) => {
      resolve({ status: error ? (error as unknown as { code?: number }).code || 1 : 0, out, err });
    });
  });
const gitOk = async (cwd: string, ...args: string[]): Promise<string> => {
  const r = await git(cwd, ...args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.err}`);
  return r.out;
};

interface Host {
  name: string;
  start: () => Promise<{
    url: string;
    close: () => Promise<void>;
    provider: GitProvider;
    /** a repository with a README, as the REST API would have made it */
    seed: (name: string) => { id: string | number; path: string };
  }>;
}

const hosts: Host[] = [
  {
    name: 'GitLab',
    start: async () => {
      const double = await startGitlabDouble();
      return {
        url: double.url,
        close: () => double.close(),
        provider: new GitLabProvider({ url: double.url }),
        seed: (name) => {
          const project = double.seedProject({ name, groupName: 'team' });
          return { id: project.id, path: project.path_with_namespace };
        },
      };
    },
  },
  {
    name: 'GitHub',
    start: async () => {
      const double = await startGithubDouble();
      return {
        url: double.url,
        close: () => double.close(),
        provider: new GitHubProvider({ client: new GitHubClient({ apiUrl: double.url }), pollMs: 2, pollAttempts: 50 }),
        seed: (name) => {
          const repo = double.state.createRepo({ owner: double.state.user, name, description: '', topics: [], defaultBranch: 'main', autoInit: true });
          return { id: repo.id, path: repo.fullName };
        },
      };
    },
  },
];

for (const host of hosts) {
  describe(`git over HTTP on ${host.name}`, () => {
    let running: Awaited<ReturnType<Host['start']>>;
    let tmp: string;
    let repo: { id: string | number; path: string };
    let remote: string;
    let work: string;

    beforeAll(async () => {
      running = await host.start();
    });
    afterAll(async () => {
      await running.close();
    });
    beforeEach(async () => {
      clearGitHubCache();
      tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linea-git-http-')));
      repo = running.seed(`app${Math.random().toString(36).slice(2, 8)}`);
      remote = `${running.url.replace('http://', 'http://dev:tok@')}/${repo.path}.git`;
      work = path.join(tmp, 'work');
      await gitOk(tmp, 'clone', '--quiet', remote, work);
    });
    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    const rest = (content: string, file: string, branch = 'main', action: 'create' | 'update' = 'create') =>
      running.provider.commit({ token, id: repo.id as never, branch, message: `rest ${file}`, track: false, actions: [{ action, path: file, content: Buffer.from(content).toString('base64'), encoding: 'base64' }] });

    it('asks for credentials, as a host does, and clones with them', async () => {
      expect(fs.readFileSync(path.join(work, 'README.md'), 'utf8')).toMatch(/^# app/);
      // a request with no credentials is asked for them, as a host does; one for a repository that is not there is not found
      const advert = `/info/refs?service=git-upload-pack`;
      const anonymous = await fetch(`${running.url}/${repo.path}.git${advert}`);
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers.get('www-authenticate')).toMatch(/Basic/);
      const missing = await fetch(`${running.url}/no/such.git${advert}`, { headers: { Authorization: 'Basic ZGV2OnRvaw==' } });
      expect(missing.status).toBe(404);
      expect((await gitOk(work, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe('main');
    });

    it('what the API changes comes down with a pull, in order, without the history being rewritten', async () => {
      await rest('one\n', 'one.txt');
      await gitOk(work, 'pull', '--quiet', '--ff-only');
      expect(fs.readFileSync(path.join(work, 'one.txt'), 'utf8')).toBe('one\n');
      const first = (await gitOk(work, 'rev-parse', 'HEAD')).trim();

      await rest('two\n', 'two.txt');
      await gitOk(work, 'pull', '--quiet', '--ff-only');
      expect(fs.existsSync(path.join(work, 'two.txt'))).toBe(true);
      // the commit seen before is still the parent: the host did not make the history again
      expect((await gitOk(work, 'rev-parse', 'HEAD~1')).trim()).toBe(first);
      expect((await gitOk(work, 'log', '--format=%s')).split('\n').filter(Boolean)).toEqual(['rest two.txt', 'rest one.txt', expect.any(String)]);
    });

    it('a branch pushed is there for the API, which can open a request for it and merge it, and the merge comes back', async () => {
      await gitOk(work, 'checkout', '--quiet', '-b', 'feature');
      fs.mkdirSync(path.join(work, 'src', 'deep dir'), { recursive: true });
      fs.writeFileSync(path.join(work, 'src', 'deep dir', 'file name.txt'), 'nested\n');
      fs.writeFileSync(path.join(work, 'blob.bin'), Buffer.from([0, 1, 2, 255, 254, 0, 10, 13]));
      await gitOk(work, 'add', '-A');
      await gitOk(work, 'commit', '--quiet', '-m', 'Add things');
      await gitOk(work, 'push', '--quiet', 'origin', 'HEAD:refs/heads/feature');

      const file = await running.provider.readFile({ token, id: repo.id as never, path: 'src/deep dir/file name.txt', ref: 'feature' });
      expect(file?.toString('utf8')).toBe('nested\n');
      expect((await running.provider.readFile({ token, id: repo.id as never, path: 'blob.bin', ref: 'feature' }))?.equals(Buffer.from([0, 1, 2, 255, 254, 0, 10, 13]))).toBe(true);
      expect(await running.provider.readFile({ token, id: repo.id as never, path: 'blob.bin', ref: 'main' })).toBeNull();

      const request = await running.provider.createChangeRequest({ token, id: repo.id as never, title: 'Add things', sourceBranch: 'feature', targetBranch: 'main' });
      expect(request.number).toBeGreaterThan(0);
      expect(await running.provider.mergeChangeRequest({ token, id: repo.id as never, number: request.number })).toBe(false);

      await gitOk(work, 'checkout', '--quiet', 'main');
      await gitOk(work, 'pull', '--quiet', '--ff-only');
      expect(fs.readFileSync(path.join(work, 'src', 'deep dir', 'file name.txt'), 'utf8')).toBe('nested\n');
      expect(fs.readFileSync(path.join(work, 'blob.bin')).equals(Buffer.from([0, 1, 2, 255, 254, 0, 10, 13]))).toBe(true);
    });

    it('a push to the default branch is the new state for the API, and a second clone gets it', async () => {
      fs.writeFileSync(path.join(work, 'direct.txt'), 'straight in\n');
      await gitOk(work, 'add', '-A');
      await gitOk(work, 'commit', '--quiet', '-m', 'Direct');
      await gitOk(work, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
      expect((await running.provider.readFile({ token, id: repo.id as never, path: 'direct.txt', ref: 'main' }))?.toString('utf8')).toBe('straight in\n');

      // a change by the API after the push is on top of it
      await rest('after\n', 'after.txt');
      const other = path.join(tmp, 'other');
      await gitOk(tmp, 'clone', '--quiet', remote, other);
      expect(fs.readFileSync(path.join(other, 'direct.txt'), 'utf8')).toBe('straight in\n');
      expect(fs.readFileSync(path.join(other, 'after.txt'), 'utf8')).toBe('after\n');
    });

    it('tags and deleted branches travel both ways', async () => {
      await running.provider.createTag({ token, id: repo.id as never, tag: 'v1.0.0', ref: 'main', message: 'one' });
      await gitOk(work, 'fetch', '--quiet', '--tags');
      expect((await gitOk(work, 'tag', '--list')).trim()).toBe('v1.0.0');

      await gitOk(work, 'tag', 'v2.0.0');
      await gitOk(work, 'push', '--quiet', 'origin', 'refs/tags/v2.0.0');
      expect(await running.provider.getTag({ token, id: repo.id as never, tag: 'v2.0.0' })).toBeTruthy();

      await gitOk(work, 'push', '--quiet', 'origin', 'HEAD:refs/heads/temp');
      expect((await running.provider.getBranch({ token, id: repo.id as never, branch: 'temp' })).name).toBe('temp');
      await gitOk(work, 'push', '--quiet', 'origin', ':refs/heads/temp');
      await expect(running.provider.getBranch({ token, id: repo.id as never, branch: 'temp' })).rejects.toThrow();
    });

    it('an update that is not a fast-forward is refused by git, not by the double', async () => {
      await rest('theirs\n', 'theirs.txt');
      fs.writeFileSync(path.join(work, 'mine.txt'), 'mine\n');
      await gitOk(work, 'add', '-A');
      await gitOk(work, 'commit', '--quiet', '-m', 'Mine');
      const refused = await git(work, 'push', 'origin', 'HEAD:refs/heads/main');
      expect(refused.status).not.toBe(0);
      expect(refused.err).toMatch(/rejected|fetch first|non-fast-forward/);
      await gitOk(work, 'pull', '--quiet', '--no-rebase', '--no-edit');
      await gitOk(work, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
      expect((await running.provider.readFile({ token, id: repo.id as never, path: 'theirs.txt', ref: 'main' }))?.toString('utf8')).toBe('theirs\n');
      expect((await running.provider.readFile({ token, id: repo.id as never, path: 'mine.txt', ref: 'main' }))?.toString('utf8')).toBe('mine\n');
    });
  });
}
