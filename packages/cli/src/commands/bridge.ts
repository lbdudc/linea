import fs from 'node:fs';
import path from 'node:path';
import open from 'open';
import {
  adoptFolder,
  checkoutsAt,
  cloneLine,
  cloneProduct,
  fetchCheckout,
  hasUnsent,
  pullCheckout,
  pushCheckout,
  type Checkout,
  type OriginBase,
} from '@lbdudc/linea-git';
import { flagString, parseFlags } from '../core/args.js';
import { splalm } from '../core/client.js';
import { findContext, type FolderContext } from '../core/context.js';
import { gitProviderOf, gitSettings } from '../core/git.js';
import {
  accessHint,
  changedCount,
  cloneUrlOf,
  git,
  helperCommand,
  isAuthFailure,
  isRepo,
  readOrigin,
  repoState,
  writeOrigin,
  type Origin,
  type RepoState,
} from '../core/gitops.js';
import { isModularLine } from '../core/workspace.js';
import { whyNoAccess } from '../core/credentialHelper.js';
import { defaultDataDir, displayPath, resolvePath } from '../core/workdir.js';
import type { SplalmLine, SplalmLineSummary, SplalmProductSummary } from '../core/types.js';
import { commandNamed } from './lookup.js';
import { needsServerText, online } from '../core/mode.js';
import type { Command, Session } from './types.js';
import { excludeFromGit } from '../core/editor.js';
import { resolveNamed } from './util.js';

const workdirOf = (session: Session): string => session.workdir ?? defaultDataDir();

// ---------------------------------------------------------------- what is where

/** What a command acts on, from where you stand: the product you are in; else the SPL and its products; else the SPLs of the workspace. */
export function checkoutsInScope(session: Session, folder: FolderContext = findContext(session.cwd ?? process.cwd())): Checkout[] {
  return checkoutsAt(folder.product || folder.line ? (session.cwd ?? process.cwd()) : folder.workspace ?? workdirOf(session), workdirOf(session));
}

// ---------------------------------------------------------------- clone

/** The address of the LINEA web client, from what the server says about login (`redirectUri` is `<client>/login`). */
export async function webUiOf(): Promise<{ webUi?: string; provider: 'gitlab' | 'github' | 'local' }> {
  try {
    const cfg = (await splalm.get('/api/users/config')) as { primary?: string; hosts?: Array<{ id: string; redirectUri?: string }> };
    const main = cfg.hosts?.find((host) => host.id === cfg.primary) ?? cfg.hosts?.[0];
    return { webUi: main?.redirectUri?.replace(/\/login\/?$/, ''), provider: main?.id === 'github' || main?.id === 'local' ? main.id : 'gitlab' };
  } catch {
    return { provider: 'gitlab' };
  }
}

/** What went wrong with a git command that the host refused: git's own words, then why (see `whyNoAccess`). Other failures as they were. */
const explained = (e: unknown, url: string): Error => {
  const error = e as Error;
  return isAuthFailure(error.message) ? new Error(`${error.message}${accessHint(error.message)}
  ${whyNoAccess(url)}`) : error;
};

/** What a clone of an SPL or a product remembers about where it came from. */
export { type OriginBase };

/** Clones a product of an SPL into the SPL's folder (see linea-git's `cloneProduct`); a refusal of the host says why. */
export async function cloneProductInto(lineDir: string, base: OriginBase, product: Parameters<typeof cloneProduct>[0]['product'], onProgress?: (line: string) => void): Promise<string> {
  try {
    return await cloneProduct({ lineDir, base, product, helper: helperCommand(), ...(onProgress ? { onProgress } : {}) });
  } catch (e) {
    throw explained(e, cloneUrlOf(product.repo.webUrl));
  }
}

const clone: Command = {
  name: 'clone',
  summary: 'Get an SPL and its products from LINEA as real git clones, to work on them here',
  usage: 'clone <spl>[:product] [--products all|none|a,b] [--dir folder]',
  flags: ['--products all|none|a,b', '--dir folder'],
  run: async ({ args, session, updateSession, setStatus }) => {
    const { positional, flags } = parseFlags(args, { value: { products: undefined, dir: undefined } });
    const target = positional[0];
    if (!target) return 'Usage: clone <spl>[:product] [--products all|none|a,b] [--dir folder]';
    if (!online(session)) throw new Error(needsServerText('get <spl>', session));

    const [lineArg, productArg] = target.split(':') as [string, string | undefined];
    setStatus('asking LINEA for your SPLs…');
    const enrolled = (await splalm.get('/api/lines/enrolled')) as SplalmLineSummary[];
    const resolved = resolveNamed(enrolled.map((l) => ({ id: l._id, name: l.name })), lineArg, 'SPL');
    if ('error' in resolved) throw new Error(`${resolved.error} See: spl list`);
    setStatus(`reading ${lineArg} on LINEA…`);
    const line = (await splalm.get(`/api/lines/${resolved.id}`)) as SplalmLine;
    if (!line.webUrl) throw new Error(`${line.name} has no repository address on the server.`);

    const all: SplalmProductSummary[] = line.products ?? [];
    const wanted = productArg
      ? [productArg]
      : (flagString(flags, 'products') ?? 'all') === 'all'
        ? all.map((p) => p.name)
        : (flagString(flags, 'products') ?? '') === 'none'
          ? []
          : (flagString(flags, 'products') ?? '').split(',').filter(Boolean);
    const unknown = wanted.filter((n) => !all.some((p) => p.name === n));
    if (unknown.length) throw new Error(`${line.name} has no product ${unknown.map((n) => `"${n}"`).join(', ')}. It has: ${all.map((p) => p.name).join(', ') || 'none'}.`);

    const root = findContext(session.cwd ?? process.cwd()).workspace ?? workdirOf(session);
    const lineDir = flagString(flags, 'dir') ? resolvePath(flagString(flags, 'dir')!) : path.join(root, line.name);
    if (!flagString(flags, 'dir')) fs.mkdirSync(root, { recursive: true });

    const { webUi, provider } = await webUiOf();
    const done: string[] = [];
    const base = { server: session.baseUrl, provider, lineId: line._id, webUi };

    if (isRepo(lineDir) && readOrigin(lineDir)?.lineId === line._id) {
      done.push(`· ${line.name} is already here (${displayPath(lineDir)})`);
    } else {
      if (fs.existsSync(lineDir) && fs.readdirSync(lineDir).length) throw new Error(`${displayPath(lineDir)} exists and is not empty.`);
      const total = 1 + wanted.filter((n) => !isRepo(path.join(lineDir, n))).length;
      setStatus(`cloning ${line.name} (1 of ${total})…`);
      try {
        await cloneLine({ dir: lineDir, base, line: { name: line.name, webUrl: line.webUrl, repoId: line.repoId }, helper: helperCommand(), onProgress: (said) => setStatus(`cloning ${line.name} (1 of ${total}): ${said}`) });
      } catch (e) {
        throw explained(e, cloneUrlOf(line.webUrl));
      }
      done.push(`✓ ${line.name}  → ${displayPath(lineDir)}`);
    }

    let n = isRepo(lineDir) && done.some((d) => d.startsWith('✓')) ? 1 : 0;
    const total = n + wanted.filter((w) => !isRepo(path.join(lineDir, w))).length;
    for (const name of wanted) {
      const product = all.find((p) => p.name === name)!;
      const dir = path.join(lineDir, name);
      if (isRepo(dir)) {
        done.push(`· ${name} is already here`);
        continue;
      }
      n++;
      setStatus(`cloning product ${name} (${n} of ${total})…`);
      await cloneProductInto(lineDir, base, product, (said) => setStatus(`cloning product ${name} (${n} of ${total}): ${said}`));
      done.push(`✓ ${name}  → ${displayPath(dir)}  (product)`);
    }
    if (all.length > wanted.length && !productArg) done.push(`  ${all.length - wanted.length} product(s) not cloned: get ${line.name}:<product>`);

    // the window moves into the SPL; a shell cannot move you, so it says where to go
    updateSession({ cwd: lineDir });
    if (session.interactive) process.chdir(lineDir);
    return [...done, '', session.interactive ? 'Next:  open · check · push' : `Next:  cd ${displayPath(lineDir)}   then   open · check · push`].join('\n');
  },
};

// ---------------------------------------------------------------- get

const get: Command = {
  name: 'get',
  summary: 'Bring an SPL and its products from LINEA (or a module or metamodel of the git host) to work on here; what is here already is updated',
  usage: 'get [spl[:product] | gitlab:group/project | github:owner/repo] [--products all|none|a,b] [--dir folder]',
  flags: ['--products all|none|a,b', '--dir folder'],
  arg: 'spl',
  run: async (ctx) => {
    const { positional, flags } = parseFlags(ctx.args, { value: { products: undefined, dir: undefined } });
    const { session } = ctx;
    const target = positional[0];

    // no name: update what is here (`get` inside an SPL is what `git pull` is inside a repository)
    if (!target) {
      if (checkoutsInScope(session).length) return pull.run(ctx);
      return [String(await commandNamed('spl list').run({ ...ctx, args: [] })), '', 'Get one with: get <name>'].join('\n');
    }

    // a place on the git host (gitlab:group/project): a module or a metamodel to change, whichever it is
    if (/^(gitlab|github):/.test(target)) {
      try {
        return await commandNamed('module clone').run(ctx);
      } catch (e) {
        if (!/is not a module/.test((e as Error).message)) throw e;
        return commandNamed('metamodel clone').run(ctx);
      }
    }

    // a name: what is not here is cloned, and what is here is updated
    const lineName = target.split(':')[0]!;
    const root = findContext(session.cwd ?? process.cwd()).workspace ?? workdirOf(session);
    const lineDir = flagString(flags, 'dir') ? resolvePath(flagString(flags, 'dir')!) : path.join(root, lineName);
    const hadIt = isRepo(lineDir) && Boolean(readOrigin(lineDir));
    const cloned = String(await clone.run(ctx));
    if (!hadIt) return cloned;
    const pulled = String(await pull.run({ ...ctx, args: [], session: { ...session, cwd: lineDir } }));
    return [cloned.split('\n').filter((l) => l.startsWith('✓')).join('\n'), pulled].filter(Boolean).join('\n');
  },
};

// ---------------------------------------------------------------- status and pull

const describeState = (s: RepoState): string => {
  const parts = [s.branch];
  if (s.upstream) parts.push([s.ahead ? `↑${s.ahead}` : '', s.behind ? `↓${s.behind}` : ''].filter(Boolean).join(' ') || 'in sync');
  else parts.push('no upstream');
  const changes = changedCount(s);
  parts.push(changes ? `${changes} changed${s.untracked ? ` (${s.untracked} new)` : ''}` : 'clean');
  return parts.join('  ');
};

const status: Command = {
  name: 'status',
  summary: 'Where your copies stand: branch, changes, what to push or get (the SPL and its products)',
  usage: 'status [--fetch]',
  flags: ['--fetch'],
  run: async ({ args, session, data, setStatus }) => {
    const scope = checkoutsInScope(session);
    if (!scope.length) {
      const here = findContext(session.cwd ?? process.cwd());
      if (here.line) return `${here.line.name} is only on this machine: it is not a git copy of anything yet. push uploads it to LINEA.`;
      return `No SPL checkouts here. Get one with: get <spl>   (looking in ${displayPath(findContext(session.cwd ?? process.cwd()).workspace ?? workdirOf(session))})`;
    }
    const rows: { checkout: Checkout; state: RepoState }[] = [];
    const lines: string[] = [];
    const width = Math.max(20, ...scope.map((c) => c.name.length + (c.kind === 'product' ? 2 : 0))) + 1;
    for (const checkout of scope) {
      if (args.includes('--fetch')) {
        setStatus(`asking the host about ${checkout.name}…`);
        await fetchCheckout({ dir: checkout.dir, helper: helperCommand() });
      }
      const state = repoState(checkout.dir);
      rows.push({ checkout, state });
      lines.push(`${checkout.kind === 'product' ? '  ' : ''}${checkout.name.padEnd(checkout.kind === 'product' ? width - 2 : width)} ${checkout.kind.padEnd(8)} ${describeState(state)}`);
    }
    data?.(rows.map(({ checkout, state }) => ({ name: checkout.name, kind: checkout.kind, ...state })));
    const todo: string[] = [];
    if (rows.some(({ state }) => changedCount(state) || state.ahead)) todo.push('push  (send your changes)');
    if (rows.some(({ state }) => state.behind)) todo.push('get  (bring what changed on LINEA)');
    return [...lines, ...(todo.length ? ['', `Next: ${todo.join(' · ')}`] : [])].join('\n');
  },
};

const pull: Command = {
  name: 'pull',
  summary: 'Update your copies from the host (fast-forward only; it stops where yours diverged)',
  usage: 'pull',
  run: async ({ session, setStatus }) => {
    const scope = checkoutsInScope(session);
    if (!scope.length) return 'No SPL checkouts here. Get one with: get <spl>';
    const out: string[] = [];
    let failed = false;
    let denied = false;
    let why = '';
    let n = 0;
    for (const c of scope) {
      n++;
      const where = scope.length > 1 ? ` (${n} of ${scope.length})` : '';
      setStatus(`updating ${c.name}${where}…`);
      const res = await pullCheckout({ dir: c.dir, helper: helperCommand(), onProgress: (said) => setStatus(`updating ${c.name}${where}: ${said}`) });
      if (res.changesAndBehind) out.push(`! ${c.name}: has changes of yours and the host moved: push or commit them first`);
      if (res.outcome === 'failed') {
        failed = true;
        const said = res.said ?? '';
        // the host said no: that is one thing to fix, said once, not once per copy
        if (res.denied) {
          if (!denied) why = whyNoAccess(readOrigin(c.dir)?.webUrl ?? '');
          denied = true;
          out.push(`✗ ${c.name}: the host did not accept your access (git said: ${said.split(/\r?\n/).slice(-1)[0]})`);
        } else {
          out.push(`✗ ${c.name}: ${said.split('\n').slice(-2).join(' ')}`);
        }
      } else {
        out.push(res.outcome === 'updated' ? `✓ ${c.name}: updated (${res.commits} new commit(s))` : `· ${c.name}: already up to date`);
      }
    }
    return [failed ? '✗ Some copies could not be updated:' : '✓ Up to date.', ...out, ...(denied ? [why, accessHint('Authentication failed').trimStart()] : [])].join('\n');
  },
};

// ---------------------------------------------------------------- push

/** Checks what is about to be sent. A line made of modules and its products are checked; plain ones have no check to run. */
async function checkBeforePush(session: Session, c: Checkout): Promise<string | undefined> {
  const lineDir = c.kind === 'product' ? c.lineDir : c.dir;
  if (!lineDir || !isModularLine(lineDir)) return undefined;
  const local: Session = { ...session, cwd: lineDir, workdir: path.dirname(lineDir) };
  const args = c.kind === 'product' ? [c.name] : [];
  try {
    const out = String(await commandNamed('check').run({ session: local, args, rest: args.join(' '), updateSession: () => {}, setStatus: () => {}, print: () => {}, clear: () => {}, exit: () => {} }));
    return out.trimStart().startsWith('✗') ? out : undefined;
  } catch (e) {
    return `✗ ${(e as Error).message}`;
  }
}

const push: Command = {
  name: 'push',
  summary: 'Check, commit and send your changes to LINEA as a merge/pull request (an SPL made here is uploaded first)',
  usage: 'push [-m message] [--direct] [--no-check]',
  flags: ['-m message', '--direct', '--no-check'],
  run: async (ctx) => {
    const { args, session, setStatus } = ctx;
    const { flags } = parseFlags(args, { value: { message: 'm' }, bool: { direct: 'd' } });
    const direct = Boolean(flags['direct']);

    // an SPL made here that LINEA does not have yet: sending it is what puts it there
    const here = findContext(session.cwd ?? process.cwd());
    if (here.line && !isRepo(here.line.dir)) {
      if (!online(session)) {
        return `${path.basename(here.line.dir)} is only on this machine. In server mode (mode server, then login), push uploads it to LINEA.`;
      }
      return link.run(ctx);
    }

    const scope = checkoutsInScope(session);
    if (!scope.length) return 'No SPL checkouts here. Get one with: get <spl>';

    const out: string[] = [];
    let failed = false;
    let sent = 0;
    for (const c of scope) {
      if (!hasUnsent(repoState(c.dir))) continue;
      const origin = readOrigin(c.dir);
      const message = flagString(flags, 'message') ?? `Update ${c.name}`;

      if (!flags['no-check']) {
        setStatus(`checking ${c.name}…`);
        const problems = await checkBeforePush(session, c);
        if (problems) {
          failed = true;
          out.push(`✗ ${c.name}: not sent, it does not check out (--no-check sends it anyway):`, ...problems.split('\n').slice(0, 12).map((l) => `    ${l}`));
          continue;
        }
      }

      let result;
      try {
        setStatus(`sending ${c.name}…`);
        const settings = origin ? gitSettings() : undefined;
        result = await pushCheckout({
          dir: c.dir,
          message,
          direct,
          user: session.user?.username ?? 'me',
          helper: helperCommand(),
          onProgress: (said) => setStatus(`sending ${c.name}: ${said}`),
          ...(settings ? { changeRequest: { provider: gitProviderOf(settings), token: settings.token } } : {}),
        });
      } catch (e) {
        failed = true;
        out.push(`✗ ${c.name}: ${explained(e, origin?.webUrl ?? '').message}`);
        continue;
      }
      sent++;

      if (result.toDefault) out.push(`✓ ${c.name}: pushed to ${result.branch}`);
      else if (!origin) out.push(`✓ ${c.name}: pushed ${result.branch} (no merge request: this copy was not made by clone)`);
      else if (result.changeRequest && 'url' in result.changeRequest) out.push(`✓ ${c.name}: pushed ${result.branch} → ${result.changeRequest.url}`);
      else out.push(`! ${c.name}: pushed ${result.branch}, but the merge request could not be opened (${result.changeRequest && 'error' in result.changeRequest ? result.changeRequest.error : 'unknown'}). Open it from the host.`);
    }
    if (!sent && !failed) return 'Nothing to push: no changes, and nothing committed that is not on the host.';
    return [failed ? '✗ Not everything was sent:' : '✓ Sent.', ...out].join('\n');
  },
};

// ---------------------------------------------------------------- link

const isProductDir = (dir: string): boolean => fs.existsSync(path.join(dir, '.linea', 'spec.json'));

const link: Command = {
  name: 'link',
  summary: 'Upload an SPL made here to LINEA: it is created there, and this folder becomes its checkout',
  usage: 'link [--desc text] [--namespace id]',
  flags: ['--desc text', '--namespace id'],
  run: async ({ args, session, setStatus }) => {
    const { flags } = parseFlags(args, { value: { desc: undefined, namespace: undefined } });
    if (!online(session)) throw new Error(needsServerText('link', session));
    const folder = findContext(session.cwd ?? process.cwd());
    const lineDir = folder.line?.dir;
    if (!lineDir) throw new Error('Run it inside the SPL you made here.');
    if (readOrigin(lineDir)) return `${path.basename(lineDir)} is already on LINEA (it was cloned from there): push sends changes.`;
    if (isRepo(lineDir)) throw new Error(`${displayPath(lineDir)} is a git repository of its own: make the SPL on LINEA with spl new --cloud and push it there with git.`);
    const name = path.basename(lineDir);

    const modular = isModularLine(lineDir);
    let modules: Record<string, string> = {};
    if (modular) {
      const spl = JSON.parse(fs.readFileSync(path.join(lineDir, 'spl.json'), 'utf8')) as { modules?: Record<string, string>; version?: string };
      modules = spl.modules ?? {};
      const local = Object.keys(modules).filter((m) => m.startsWith('file:'));
      if (local.length) {
        throw new Error(`LINEA can only use modules that are on the git host, and ${local.join(', ')} ${local.length === 1 ? 'is' : 'are'} only in your workspace: publish ${local.length === 1 ? 'it' : 'them'} first (module publish <name> --to <group or owner>) and use ${local.length === 1 ? 'its' : 'their'} gitlab:/github: location (spl add <location>).`);
      }
    }
    setStatus(`making ${name} on LINEA…`);
    const created = (await splalm.post('/api/lines', {
      name,
      version: '1.0.0',
      description: flagString(flags, 'desc') ?? name,
      // (what the server takes: the kind of SPL, and the modules of a modular one)
      kind: modular ? 'modular' : 'plain',
      ...(modular ? { modules } : {}),
      ...(flagString(flags, 'namespace') ? { parentNamespaceId: /^\d+$/.test(flagString(flags, 'namespace')!) ? Number(flagString(flags, 'namespace')) : flagString(flags, 'namespace') } : {}),
    })) as SplalmLine;

    // the new repository has the scaffold of a line: what is here goes on top of it, and the result is what LINEA has
    let adopted;
    try {
      adopted = await adoptFolder({
        dir: lineDir,
        url: cloneUrlOf(created.webUrl),
        name,
        helper: helperCommand(),
        onProgress: (what, said) => setStatus(`${what === 'getting' ? 'getting the new repository of' : 'uploading'} ${name}: ${said}`),
      });
    } catch (e) {
      throw explained(e, created.webUrl);
    }
    const { webUi, provider } = await webUiOf();
    // the folder became a repository just now: what checking makes in it is not for the repository
    excludeFromGit(lineDir, '.linea/composed-model.uvl');
    writeOrigin(lineDir, { kind: 'spl', name, server: session.baseUrl, provider, lineId: created._id, projectId: created.repoId, webUrl: created.webUrl, defaultBranch: adopted.defaultBranch, webUi });
    return [
      `✓ ${name} is on LINEA (${adopted.copied} file(s) uploaded): ${created.webUrl}`,
      `  This folder is its checkout now: status · push · get work here.`,
      ...(listLocalProductsIn(lineDir).length ? ['  Its products stay here for now: make them on LINEA with: product new <name> --cloud'] : []),
    ].join('\n');
  },
};

const listLocalProductsIn = (lineDir: string): string[] =>
  fs.readdirSync(lineDir, { withFileTypes: true }).filter((e) => e.isDirectory() && isProductDir(path.join(lineDir, e.name))).map((e) => e.name);

// ---------------------------------------------------------------- web and repo

/** The origin of what is meant: the product you are in, or the SPL, or the named one inside the SPL. */
function originFor(session: Session, name?: string): Origin | undefined {
  const folder = findContext(session.cwd ?? process.cwd());
  if (name && folder.line) {
    const product = path.join(folder.line.dir, name);
    if (isRepo(product)) return readOrigin(product);
  }
  if (name && !folder.line) {
    const dir = path.join(folder.workspace ?? workdirOf(session), name);
    if (isRepo(dir)) return readOrigin(dir);
  }
  if (name) return undefined;
  if (folder.product) return readOrigin(folder.product.dir);
  if (folder.line) return readOrigin(folder.line.dir);
  return undefined;
}

const launch = async (url: string, print: boolean): Promise<string> => {
  if (!print) await open(url);
  return print ? url : `✓ Opened ${url}`;
};

const web: Command = {
  name: 'web',
  summary: 'Open the SPL or product in the LINEA web interface',
  usage: 'web [product] [--print]',
  flags: ['--print'],
  arg: 'product',
  run: async ({ args, session }) => {
    const { positional, flags } = parseFlags(args);
    const origin = originFor(session, positional[0]);
    if (!origin) throw new Error('No SPL or product here that was cloned from LINEA (clone it first, or name a product inside an SPL).');
    if (!origin.webUi) throw new Error('The address of the LINEA web interface is not known for this copy: clone again while the server is up.');
    const url = origin.kind === 'product' ? `${origin.webUi}/products/${origin.productId}` : `${origin.webUi}/lines/${origin.lineId}`;
    return launch(url, Boolean(flags['print']));
  },
};

const repo: Command = {
  name: 'repo',
  summary: 'Open the repository of the SPL or product on GitLab / GitHub',
  usage: 'repo [product] [--print]',
  flags: ['--print'],
  arg: 'product',
  run: async ({ args, session }) => {
    const { positional, flags } = parseFlags(args);
    const origin = originFor(session, positional[0]);
    const url = origin?.webUrl ?? (() => {
      const dir = checkoutsInScope(session)[0]?.dir;
      const remote = dir ? git(dir, ['remote', 'get-url', 'origin']).stdout.trim() : '';
      return remote.replace(/\.git$/, '').replace(/^git@([^:]+):/, 'https://$1/');
    })();
    if (!url) throw new Error('No repository here.');
    return launch(url, Boolean(flags['print']));
  },
};

/** `clone`, `pull` and `link` are what `get` and `push` do: they are not commands of their own. */
export { web, repo };
export const bridgeCommands: Command[] = [get, status, push];
