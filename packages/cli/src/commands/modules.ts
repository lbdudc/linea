import path from 'node:path';
import { ModuleCheckError, type Diagnostic } from '@lbdudc/linea-core';
import { findContext } from '../core/context.js';
import { createLocalLine, healthLocalProduct, listLocalProducts, localProductDir } from '../core/workspace.js';
import {
  checkLocalLine,
  checkLocalPackage,
  checkLocalProductModels,
  createLocalModularLine,
  getLocalLineModules,
  isModularLine,
  listLocalPackages,
  locationOf,
  setLocalLineModules,
} from '../core/workspace.js';
import { displayPath } from '../core/workdir.js';
import type { Command, Session } from './types.js';
import { requireLine, resolveProductName, workdirOf } from './util.js';

const requireModularLine = (session: Session): string => {
  const lineDir = requireLine(session);
  if (!isModularLine(lineDir)) throw new Error('This SPL is not made of modules. Make one with: spl new <name>');
  return lineDir;
};

const describe = (d: Diagnostic): string => {
  const where = `${d.package.replace(/^file:/, '')}${d.file ? ` · ${d.file}` : ''}`;
  return `  ${d.severity === 'error' ? '✗' : '!'} ${where}: ${d.message}`;
};

const report = (diagnostics: readonly Diagnostic[]): string[] => diagnostics.map(describe);

/** Failures of the packages are for people to read: say what is wrong, not where the exception came from. */
const explain = (error: unknown): string => {
  if (error instanceof ModuleCheckError) return ['✗ They do not fit together:', ...report(error.diagnostics)].join('\n');
  return (error as Error).message;
};

/** An SPL made of modules, here: a folder in the workspace. The window moves into it. */
export function createModularLineHere(session: Session, name: string, updateSession: (patch: Partial<Session>) => void): string {
  const line = createLocalModularLine({ workdir: workdirOf(session), name });
  updateSession({ cwd: line.dir });
  if (session.interactive) process.chdir(line.dir);
  return `✓ Created ${line.name} at ${displayPath(line.dir)}. Next: spl add <module>, product new <name>`;
}

/** A classic SPL (its own platform: a feature model and nothing else; the data model, the sensors and the rest are metamodels of modules), here. */
export function createPlainLineHere(session: Session, name: string, updateSession: (patch: Partial<Session>) => void): string {
  const line = createLocalLine({ workdir: workdirOf(session), name });
  updateSession({ cwd: line.dir });
  if (session.interactive) process.chdir(line.dir);
  return `✓ Created ${line.name} at ${displayPath(line.dir)}. Next: fm show, product new <name>`;
}

/** The modules of a modular SPL: the ones it names, and everything they bring in. (What `spl show` adds to an SPL made of modules.) */
export async function describeModules(session: Session): Promise<string> {
  const lineDir = requireModularLine(session);
  const view = await getLocalLineModules(workdirOf(session), lineDir);
  const direct = Object.entries(view.modules);
  if (!direct.length) return 'No modules yet. Add one with: spl add <module> [range]   (module list --remote shows the ones on your git host)';
  const rows = view.packages.map(
    (p) => `  ${p.kind === 'module' ? 'module   ' : 'metamodel'}  ${p.name}  v${p.version}  ← ${p.requiredBy.map((r) => r.replace(/^file:/, '')).join(', ')}`,
  );
  return ['Direct modules:', ...direct.map(([location, range]) => `  ${location.replace(/^file:modules\//, '')}  ${range}`), '', 'Resolved (dependencies first):', ...rows].join('\n');
}

const modules: Command = {
  name: 'spl modules',
  hidden: true,
  summary: 'The modules of the SPL and everything they bring in (spl show has them too)',
  usage: 'spl modules',
  run: ({ session }) => describeModules(session),
};

const addmodule: Command = {
  name: 'spl add',
  summary: 'Add a module (a name of your workspace, or gitlab:… / github:… of the git host); what it needs comes with it',
  usage: 'spl add <module> [range]',
  run: async ({ args, session }) => {
    const name = args[0];
    if (!name) return 'Usage: spl add <module> [range]';
    const lineDir = requireModularLine(session);
    const workdir = workdirOf(session);
    // a package of the git host is named by its location (`gitlab:group/project`, `github:owner/repo`: see module list --remote), one of the workspace by its name
    const remote = /^(gitlab|github):/.test(name);
    const pkg = remote ? undefined : listLocalPackages(workdir).find((p) => p.kind === 'module' && p.name === name);
    if (!remote && !pkg) throw new Error(`No module "${name}" in ${path.join(workdir, 'modules')}. See: module list (and module list --remote for the git host).`);
    const current = (await getLocalLineModules(workdir, lineDir)).modules;
    const next = { ...current, [pkg?.location ?? name]: args[1] ?? (pkg ? `^${pkg.version}` : '*') };
    try {
      const { resolved } = await setLocalLineModules(workdir, lineDir, next);
      return `✓ ${pkg?.name ?? name} added. The SPL now uses ${resolved.modules.length} module(s) and ${resolved.metamodels.length} metamodel(s); the lockfile is up to date.`;
    } catch (e) {
      return explain(e);
    }
  },
};

const rmmodule: Command = {
  name: 'spl remove',
  summary: 'Remove a module from the SPL',
  usage: 'spl remove <module>',
  run: async ({ args, session }) => {
    const name = args[0];
    if (!name) return 'Usage: spl remove <module>';
    const lineDir = requireModularLine(session);
    const workdir = workdirOf(session);
    const location = /^(gitlab|github):/.test(name) ? name : locationOf('module', name);
    const current = (await getLocalLineModules(workdir, lineDir)).modules;
    if (!(location in current)) throw new Error(`The SPL does not use "${name}" directly. See: spl show`);
    const { [location]: _removed, ...rest } = current;
    try {
      await setLocalLineModules(workdir, lineDir, rest);
      return `✓ ${name} removed.`;
    } catch (e) {
      return explain(e);
    }
  },
};

const check: Command = {
  name: 'check',
  summary: 'Check an SPL, a product, a module or a metamodel: the one you are in, or name it',
  usage: 'check [product|module|metamodel]',
  arg: 'product',
  run: async ({ args, session, data }) => {
    const workdir = workdirOf(session);
    const folder = findContext(session.cwd ?? process.cwd());
    const target = args.find((a) => !a.startsWith('-'));
    const lineDir = folder.line?.dir;
    const isProduct = Boolean(target && lineDir && listLocalProducts(lineDir).some((p) => p.name === target));

    // a package: the one you name (when it is not a product of the SPL you are in), or the one you stand in
    const localPackages = listLocalPackages(workdir);
    const asPackage = target
      ? isProduct
        ? undefined
        : localPackages.find((p) => p.name === target)
      : folder.package && !folder.line
        ? localPackages.find((p) => p.dir === folder.package!.dir) ?? { kind: folder.package.kind, name: folder.package.name, version: '?', dir: folder.package.dir, location: '', description: '' }
        : undefined;
    if (asPackage) {
      const result = await checkLocalPackage(path.dirname(path.dirname(asPackage.dir)), asPackage.kind, asPackage.name);
      data?.({ kind: asPackage.kind, name: asPackage.name, ...result });
      return [
        result.ok ? `✓ ${asPackage.kind} ${asPackage.name} v${asPackage.version} checks out.` : `✗ ${asPackage.kind} ${asPackage.name} has problems:`,
        `  brings in ${result.resolved.modules} module(s) and ${result.resolved.metamodels} metamodel(s)`,
        ...report(result.diagnostics),
      ].join('\n');
    }

    const line = requireLine(session);
    if (target && !isProduct) {
      throw new Error(`Nothing called "${target}": not a product of ${path.basename(line)}, nor a module or metamodel of ${displayPath(workdir)}.`);
    }

    // a plain SPL has no modules to check, and its products are checked against its feature model
    if (!isModularLine(line)) {
      if (!target) return `${path.basename(line)} is a plain SPL (no modules): check a product with: check <product>`;
      const h = await healthLocalProduct(line, target);
      data?.({ product: target, ok: h.valid, error: h.error });
      return h.valid ? `✓ The features of ${target} fit the SPL.` : `✗ ${target}: ${h.error ?? 'invalid'}${h.errorType ? ` [${h.errorType}]` : ''}`;
    }

    if (target) {
      const result = await checkLocalProductModels(workdir, line, localProductDir(line, target));
      const needs = result.metamodels.map((m) => `${m.name} (${m.name in result.models ? 'has a model' : 'MISSING'})`).join(', ');
      data?.({ product: target, ok: result.ok, diagnostics: result.diagnostics });
      return [
        result.ok ? `✓ The models of ${target} are valid and fit its SPL.` : `✗ The models of ${target} have problems:`,
        `  Needs a model of: ${needs || 'nothing'}`,
        ...report(result.diagnostics),
      ].join('\n');
    }

    const { resolved, report: result } = await checkLocalLine(workdir, line);
    data?.({ ok: result.ok, diagnostics: result.diagnostics });
    return [
      result.ok ? '✓ The modules fit together.' : '✗ The modules have problems:',
      `  ${resolved.modules.length} module(s), ${resolved.metamodels.length} metamodel(s); products need a model of: ${result.metamodels.map((m) => m.name).join(', ') || 'nothing'}`,
      ...report(result.diagnostics),
    ].join('\n');
  },
};

/** The models of a product of an SPL made of modules, and the metamodels it still needs one of. (What `product show` adds.) */
export async function describeProductModels(session: Session, product?: string): Promise<string> {
  const lineDir = requireModularLine(session);
  const name = resolveProductName(lineDir, product);
  const productDir = localProductDir(lineDir, name);
  const result = await checkLocalProductModels(workdirOf(session), lineDir, productDir);
  const rows = result.metamodels.map((m) => {
    const file = `models/${m.name}.${m.extension}`;
    const problems = result.diagnostics.filter((d) => d.file === file && d.severity === 'error').length;
    const state = !(m.name in result.models) ? 'missing' : problems ? `${problems} error(s)` : 'ok';
    return `  ${m.name}  ${path.join(productDir, file)}  [${state}]`;
  });
  const offered = result.offered.map((o) => `  ${o.origin} offers a ${o.metamodel} model (read-only): ${o.package.replace(/^file:/, '')}/${o.file}`);
  return [
    rows.length ? 'Models:' : 'This SPL needs no models.',
    ...rows,
    ...(offered.length ? ['', 'Offered by the modules:', ...offered] : []),
    '',
    `Edit the files, then: check ${name}`,
  ].join('\n');
}

const models: Command = {
  name: 'product models',
  hidden: true,
  summary: 'The models a product has, and the metamodels it still needs one of (product show has them too)',
  usage: 'product models [product]',
  arg: 'product',
  run: ({ args, session }) => describeProductModels(session, args.find((a) => !a.startsWith('-'))),
};

export const moduleCommands: Command[] = [modules, addmodule, rmmodule, check, models];
