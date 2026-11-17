import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findContext, initWorkspace } from '../core/context.js';
import { findEditor } from '../core/editor.js';
import { accessHint, credentialOptions, gitAsync, readOrigin } from '../core/gitops.js';
import { listLocalLines } from '../core/workspace.js';
import { gitSettings, hostLabel } from '../core/git.js';
import { defaultDataDir, displayPath, resolvePath } from '../core/workdir.js';
import { findPlace, parentOf, placesFrom } from '../core/places.js';
import { workdirOf } from './util.js';
import type { Command, Session } from './types.js';

const init: Command = {
  name: 'init',
  summary: 'Make a folder a workspace: where your SPLs, modules and metamodels live side by side',
  usage: 'init [folder]',
  arg: 'file',
  run: ({ args, session }) => {
    const target = args.find((a) => !a.startsWith('--'));
    const dir = target ? resolvePath(target) : (session.cwd ?? process.cwd());
    const already = findContext(dir).workspace === dir;
    const abs = initWorkspace(dir);
    return [
      `${already ? '✓ Already a workspace' : '✓ Workspace created'}: ${abs}`,
      '  modules/ and metamodels/ hold the packages you write; an SPL goes next to them (spl new, clone).',
      `  Work from here: cd ${displayPath(abs)}`,
    ].join('\n');
  },
};

type Level = 'ok' | 'warn' | 'fail';
interface Check {
  level: Level;
  label: string;
  detail: string;
}

const MARK: Record<Level, string> = { ok: '  ✓', warn: '  !', fail: '  ✗' };

/** Whether the server answers, and which git host it is on. */
async function probeServer(baseUrl: string): Promise<Check> {
  try {
    const res = await fetch(`${baseUrl}/api/users/config`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { level: 'fail', label: 'server', detail: `${baseUrl} answered ${res.status}` };
    const cfg = (await res.json()) as { primary?: string };
    return { level: 'ok', label: 'server', detail: `${baseUrl} (git host: ${hostLabel(cfg.primary)})` };
  } catch (e) {
    return { level: 'fail', label: 'server', detail: `${baseUrl} does not answer (${(e as Error).message}). Set it with: config server <url>` };
  }
}

/** Whether git gets into a repository you have here, the way `get` and `push` do: through the same access, on one of your clones. */
async function probeGitAccess(session: Session): Promise<Check> {
  const folder = findContext(session.cwd ?? process.cwd());
  const root = folder.workspace ?? workdirOf(session);
  const candidates = [folder.product?.dir, folder.line?.dir, ...listLocalLines(root).map((l) => l.dir)].filter((d): d is string => Boolean(d));
  const dir = candidates.find((d) => readOrigin(d));
  const origin = dir ? readOrigin(dir) : undefined;
  if (!dir || !origin) return { level: 'warn', label: 'git access', detail: 'nothing to try it on: get an SPL first (get <spl>)' };
  const res = await gitAsync(dir, [...credentialOptions(origin.webUrl), 'ls-remote', '--heads', 'origin']);
  if (res.status === 0) return { level: 'ok', label: 'git access', detail: `reads ${origin.name} on the host` };
  const said = (res.stderr || res.stdout).trim();
  return { level: 'fail', label: 'git access', detail: `the host refused ${origin.name}: ${said.split('\n').slice(-1)[0] ?? ''}${accessHint(said)}` };
}

export async function runChecks(session: Session, opts: { online: boolean }): Promise<Check[]> {
  const checks: Check[] = [];

  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  checks.push(
    git.status === 0
      ? { level: 'ok', label: 'git', detail: git.stdout.trim() }
      : { level: 'fail', label: 'git', detail: 'not on your PATH: clone, pull and push need it (https://git-scm.com)' },
  );

  const workdir = session.workdir ?? defaultDataDir();
  const isWorkspace = fs.existsSync(path.join(workdir, '.linea', 'workspace.json'));
  checks.push(
    !fs.existsSync(workdir)
      ? { level: 'warn', label: 'workspace', detail: `${displayPath(workdir)} does not exist yet (init creates it)` }
      : { level: isWorkspace ? 'ok' : 'warn', label: 'workspace', detail: `${displayPath(workdir)}${isWorkspace ? '' : ' (not marked: run init there to make it a workspace)'}` },
  );

  try {
    const editor = findEditor({ preferred: session.editor });
    checks.push(editor ? { level: 'ok', label: 'editor', detail: editor.name } : { level: 'warn', label: 'editor', detail: 'none found: install VS Code, or: config editor <command>' });
  } catch (e) {
    checks.push({ level: 'warn', label: 'editor', detail: (e as Error).message });
  }

  try {
    const { config, source } = gitSettings();
    const where = config.provider === 'github' ? (config.github?.webUrl ?? 'github.com') : config.provider === 'local' ? (config.local?.baseUrl ?? '') : (config.gitlab?.url ?? '');
    const from = { environment: 'from the environment', server: "from LINEA's server", token: 'a personal access token you gave' }[source];
    checks.push({ level: 'ok', label: 'git host', detail: `${hostLabel(config.provider)} ${where}, access ${from}` });
  } catch (e) {
    checks.push({ level: 'warn', label: 'git host', detail: (e as Error).message });
  }

  if (opts.online) {
    checks.push(await probeServer(session.baseUrl));
    checks.push(session.authed ? { level: 'ok', label: 'signed in', detail: session.user?.username ?? 'yes' } : { level: 'warn', label: 'signed in', detail: 'no: run login' });
    checks.push(await probeGitAccess(session));
  } else {
    checks.push({ level: 'ok', label: 'server', detail: `not checked (doctor --online checks ${session.baseUrl})` });
  }
  return checks;
}

const doctor: Command = {
  name: 'doctor',
  summary: 'Check that everything linea needs is there: git, workspace, editor, git host, server',
  usage: 'doctor [--online]',
  flags: ['--online'],
  run: async ({ args, session, data }) => {
    const online = args.includes('--online');
    const checks = await runChecks(session, { online });
    data?.(checks);
    const fails = checks.filter((c) => c.level === 'fail').length;
    const warns = checks.filter((c) => c.level === 'warn').length;
    const head = fails ? `✗ ${fails} problem(s)` : warns ? `✓ Works, with ${warns} thing(s) to look at` : '✓ Everything is in place';
    return [head, ...checks.map((c) => `${MARK[c.level]} ${c.label.padEnd(10)} ${c.detail}`)].join('\n');
  },
};

const cd: Command = {
  name: 'cd',
  summary: 'Move the window into an SPL, a product, a module or a metamodel, by its name (`cd ..` goes up; in a shell, use your own cd)',
  usage: 'cd [name]',
  arg: 'place',
  run: ({ args, session, updateSession }) => {
    if (!session.interactive) return 'cd moves the window; in a shell, cd to the folder yourself (the commands act on the folder you are in).';
    const here = path.resolve(session.cwd ?? process.cwd());
    const where = args.find((a) => !a.startsWith('-'));
    const places = placesFrom(here, workdirOf(session));

    // a name, which is how things are known; `..` goes up; nothing goes to the workspace; a path is the last resort
    let dir: string | undefined;
    if (!where) dir = findContext(here).workspace ?? workdirOf(session);
    else if (where === '..') dir = parentOf(findContext(here).product?.dir ?? findContext(here).line?.dir ?? findContext(here).package?.dir ?? here);
    else dir = findPlace(places, where)?.dir ?? [resolvePath(where), path.join(here, where)].find((d) => fs.existsSync(d) && fs.statSync(d).isDirectory());
    if (!dir || !fs.existsSync(dir)) {
      const known = places.map((p) => p.name);
      throw new Error(`No SPL, product, module or metamodel called "${where}".${known.length ? ` Here: ${known.slice(0, 12).join(', ')}${known.length > 12 ? '…' : ''}.` : ' Make one with: spl new <name>'}`);
    }
    updateSession({ cwd: dir });
    process.chdir(dir);
    const now = findContext(dir);
    return `✓ ${displayPath(dir)}${now.product ? `  (product ${now.product.name})` : now.line ? `  (SPL ${now.line.name})` : now.package ? `  (${now.package.kind} ${now.package.name})` : ''}`;
  },
};

export const setupCommands: Command[] = [init, doctor, cd];
