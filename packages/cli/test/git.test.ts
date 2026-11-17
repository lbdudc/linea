import { withFeatureMetamodel } from './helpers.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it , setDefaultTimeout } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitLabProvider, clearReadCache } from '@lbdudc/linea-git';
import { startGithubDouble, startGitlabDouble } from '@lbdudc/linea-git/testing';
import { getCommand } from '../src/commands/registry.js';
import type { CommandContext, Session } from '../src/commands/types.js';
import { gitSettings, gitToken } from '../src/core/git.js';
import { createLocalModularLine, createLocalPackage, getLocalLineModules } from '../src/core/workspace.js';

// The CLI on a git host: GitLab and GitHub, here the in-memory ones of @lbdudc/linea-git (the same library the server uses).

// real git, one process per call: slow on some machines
setDefaultTimeout(60_000);

const ENV_KEYS = ['LINEA_HOME', 'GIT_PROVIDER', 'GITLAB_HOSTNAME', 'GITLAB_TOKEN', 'GITHUB_URL', 'GITHUB_API_URL', 'GITHUB_TOKEN', 'LINEA_GIT_TOKEN', 'LINEA_TRUSTED_NAMESPACES', 'LINEA_REGISTRY'];
const saved: Record<string, string | undefined> = {};
beforeAll(() => { for (const key of ENV_KEYS) saved[key] = process.env[key]; });
afterAll(() => { for (const key of ENV_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
// a throwaway home: what `login` stored on this machine is not what these tests are about
beforeEach(() => { clearReadCache(); for (const key of ENV_KEYS) delete process.env[key]; process.env['LINEA_HOME'] = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-git-home-')); });

describe('gitSettings', () => {
  it('says what is missing: the address of GitLab, then a token', () => {
    process.env['GIT_PROVIDER'] = 'gitlab';
    expect(() => gitSettings()).toThrow(/GITLAB_HOSTNAME/);
    process.env['GITLAB_HOSTNAME'] = 'https://gitlab.example.com';
    expect(() => gitSettings()).toThrow(/GITLAB_TOKEN/);
    process.env['GITLAB_TOKEN'] = 't';
    expect(gitSettings().config.provider).toBe('gitlab');
  });

  it('works for GitHub with its own token, or with LINEA_GIT_TOKEN for either', () => {
    process.env['GIT_PROVIDER'] = 'github';
    expect(() => gitSettings()).toThrow(/GITHUB_TOKEN/);
    process.env['GITHUB_TOKEN'] = 'gh';
    expect(gitToken(gitSettings().config)).toBe('gh');
    process.env['LINEA_GIT_TOKEN'] = 'any';
    expect(gitSettings().token).toBe('any');
  });
});

interface Host {
  name: string;
  start: () => Promise<{ env: Record<string, string>; root: string; prepare: (url: string) => Promise<void>; location: (name: string) => string; close: () => Promise<void> }>;
}

const hosts: Host[] = [
  {
    name: 'GitLab',
    start: async () => {
      const double = await startGitlabDouble();
      return {
        env: { GIT_PROVIDER: 'gitlab', GITLAB_HOSTNAME: double.url, GITLAB_TOKEN: 'tok' },
        root: 'registry',
        prepare: async (url) => { await new GitLabProvider({ url }).createNamespace({ token: 'tok', name: 'registry' }); },
        location: (name) => `gitlab:registry/modules/${name}`,
        close: () => double.close(),
      };
    },
  },
  {
    name: 'GitHub',
    start: async () => {
      const double = await startGithubDouble();
      return {
        env: { GIT_PROVIDER: 'github', GITHUB_URL: double.url, GITHUB_API_URL: double.url, GITHUB_TOKEN: 'tok' },
        root: 'dev',
        prepare: async () => {},
        location: (name) => `github:dev/${name}`,
        close: () => double.close(),
      };
    },
  },
];

for (const host of hosts) {
  describe(`the CLI on ${host.name}`, () => {
    let running: Awaited<ReturnType<Host['start']>>;
    const dirs: string[] = [];
    const workspace = (): string => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-cli-git-'));
      withFeatureMetamodel(dir);
      dirs.push(dir);
      return dir;
    };

    beforeEach(async () => {
      running = await host.start();
      Object.assign(process.env, running.env);
      await running.prepare(running.env['GITLAB_HOSTNAME'] ?? '');
    });
    afterEach(async () => {
      await running.close();
      for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    });

    const run = async (name: string, args: string[], workdir: string, patch: Partial<Session> = {}): Promise<string> => {
      const session: Session = { baseUrl: '', authed: true, workdir, cwd: workdir, ...patch };
      const ctx: CommandContext = {
        args, rest: args.join(' '), session,
        updateSession: (p) => Object.assign(session, p),
        setStatus: () => {}, print: () => {}, clear: () => {}, exit: () => {},
      };
      return (await getCommand(name)!.run(ctx)) as string;
    };

    /** A workspace with a metamodel and a module that needs it. */
    const author = (): string => {
      const dir = workspace();
      createLocalPackage({ workdir: dir, kind: 'metamodel', name: 'shapes' });
      const mod = createLocalPackage({ workdir: dir, kind: 'module', name: 'draw' });
      const manifest = JSON.parse(fs.readFileSync(path.join(mod.dir, '.linea', 'module.json'), 'utf8'));
      manifest.requires.metamodels = { '../../metamodels/shapes': '^0.1.0' };
      fs.writeFileSync(path.join(mod.dir, '.linea', 'module.json'), JSON.stringify(manifest));
      return dir;
    };

    it('publishes the packages of the workspace, and lists them from the host', async () => {
      const dir = author();
      expect(await run('publish', [running.root, '--dry-run'], dir)).toMatch(/would publish.*draw[\s\S]*Dry run/);
      expect(await run('module list', ['--remote'], workspace())).toMatch(/No modules/);

      const out = await run('publish', [running.root], dir);
      expect(out).toMatch(/published\s+metamodel shapes v0\.1\.0/);
      expect(out).toMatch(/published\s+module draw v0\.1\.0/);

      const listed = await run('module list', ['--remote'], workspace());
      expect(listed).toContain(running.location('draw'));
      expect(await run('metamodel list', ['--remote'], workspace())).toMatch(/metamodel\s+shapes\s+v0\.1\.0/);

      expect(await run('publish', [running.root], dir)).toMatch(/already published\s+module draw/);
    });

    it('uses a module of the host from a local SPL: the library reads it, and what it needs comes with it', async () => {
      await run('publish', [running.root], author());

      const other = workspace();
      const line = createLocalModularLine({ workdir: other, name: 'gis' });
      const session = { cwd: line.dir };
      const added = await run('spl add', [running.location('draw')], other, session);
      expect(added).toMatch(/draw added.*1 module.*3 metamodel/);

      const view = await getLocalLineModules(other, line.dir);
      expect(Object.keys(view.modules)).toEqual([running.location('draw')]);
      expect(view.packages.map((p) => p.name).sort()).toEqual(['common', 'draw', 'featuremodel', 'shapes']);

      expect(await run('spl remove', [running.location('draw')], other, session)).toMatch(/removed/);
    });

    it('does not use a package from where it is not trusted', async () => {
      await run('publish', [running.root], author());
      process.env['LINEA_TRUSTED_NAMESPACES'] = 'somewhere-else, github:somebody-else';
      const other = workspace();
      const line = createLocalModularLine({ workdir: other, name: 'gis' });
      const out = await run('spl add', [running.location('draw')], other, { cwd: line.dir }).catch((e: Error) => e.message);
      expect(out).toMatch(/outside the trusted namespaces/);
    });
  });
}
