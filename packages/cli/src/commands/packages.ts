import fs from 'node:fs';
import path from 'node:path';
import { clonePackage, publishFolder, type PackageKind, type PackageSummary } from '@lbdudc/linea-git';
import { flagString, parseFlags } from '../core/args.js';
import { findContext } from '../core/context.js';
import { helperCommand, readOrigin } from '../core/gitops.js';
import { gitProviderOf, gitSettings, hostLabel, remotePackages } from '../core/git.js';
import { bumpPackageVersion, changeProductFeatures, nextVersion, readLocalProductSpec, splsUsing } from '../core/workspace.js';
import { createLocalPackage, isModularLine, listLocalPackages, updateLocalLineLock, type LocalPackage } from '../core/workspace.js';
import { displayPath, resolvePath } from '../core/workdir.js';
import { commandNamed } from './lookup.js';
import type { Command, CommandContext } from './types.js';
import { requireLine, workdirOf } from './util.js';
import { removeFromProductSelection, unknownFeatures, writeProductSelection } from '../core/selection.js';

const DIRS: Record<PackageKind, string> = { module: 'modules', metamodel: 'metamodels' };
const MANIFEST: Record<PackageKind, string> = { module: '.linea/module.json', metamodel: 'metamodel.json' };
const LOCATION = /^(gitlab|github):(.+)$/;

const row = (kind: PackageKind, name: string, version: string, where: string, description: string): string =>
  `  ${kind === 'module' ? 'module   ' : 'metamodel'}  ${name.padEnd(18)} ${version.padEnd(11)} ${where}${description ? `  — ${description}` : ''}`;

const matches = (search: string | undefined, ...fields: string[]): boolean =>
  !search || fields.some((f) => f.toLowerCase().includes(search.toLowerCase()));

function commandsFor(kind: PackageKind): Command[] {
  const noun = kind;
  const plural = `${kind}s`;
  const other = kind === 'module' ? 'metamodel' : 'module';

  const list: Command = {
    name: `${noun} list`,
    summary: `The ${plural} of your workspace, or on your git host (--remote)`,
    usage: `${noun} list [search] [--remote]`,
    flags: ['--remote'],
    run: async ({ args, session, data }) => {
      const { positional, flags } = parseFlags(args);
      const search = positional[0];
      if (flags['remote']) {
        const settings = gitSettings();
        const found = (await remotePackages({ settings, kind })).filter((p) => matches(search, p.name, p.description, p.location));
        data?.(found);
        const registry = settings.config.registry;
        if (!found.length) {
          return registry
            ? `No ${plural}${search ? ` matching "${search}"` : ''} in the registry ${registry}. Add one with: registry add <location>`
            : `No ${plural}${search ? ` matching "${search}"` : ''} on ${hostLabel(settings.config.provider)} (a repository counts when it has the topic linea-${kind}).`;
        }
        return [...found.map((p) => row(kind, p.name, p.unavailable ? 'unreachable' : p.latest ? `v${p.latest}` : 'unpublished', p.location, p.description)), '', `Get one to work on it: ${noun} clone <location>   ·   use it from an SPL: spl add <location>`].join('\n');
      }
      const local = listLocalPackages(workdirOf(session)).filter((p) => p.kind === kind && matches(search, p.name, p.description));
      data?.(local);
      if (!local.length) return `No ${plural} in ${displayPath(workdirOf(session))}${search ? ` matching "${search}"` : ''}. Create one with: ${noun} new <name>   (${noun} list --remote shows the git host's)`;
      return local.map((p) => row(kind, p.name, `v${p.version}`, displayPath(p.dir), p.description)).join('\n');
    },
  };

  const show: Command = {
    name: `${noun} show`,
    summary: `One ${noun}: its versions, what it requires${kind === 'module' ? ', what it offers' : ''} and who uses it`,
    usage: `${noun} show <name|location>`,
    run: async ({ args, session, data }) => {
      const target = args.find((a) => !a.startsWith('-')) ?? findContext(session.cwd ?? process.cwd()).package?.name;
      if (!target) return `Usage: ${noun} show <name|location>`;
      if (LOCATION.test(target)) {
        const settings = gitSettings();
        const found = (await remotePackages({ settings, kind })).find((p) => p.location === target);
        if (!found) throw new Error(`No ${noun} at ${target} on the git host. See: ${noun} list --remote`);
        data?.(found);
        return describeRemote(found);
      }
      const pkg = listLocalPackages(workdirOf(session)).find((p) => p.kind === kind && p.name === target);
      if (!pkg) throw new Error(`No ${noun} "${target}" in ${displayPath(workdirOf(session))}. See: ${noun} list`);
      const manifest = JSON.parse(fs.readFileSync(path.join(pkg.dir, MANIFEST[kind]), 'utf8')) as { requires?: unknown; offers?: Record<string, string> };
      const requires = manifest.requires as { modules?: Record<string, string>; metamodels?: Record<string, string> } | Record<string, string> | undefined;
      const reqModules = kind === 'module' ? ((requires as { modules?: Record<string, string> })?.modules ?? {}) : {};
      const reqMetamodels = kind === 'module' ? ((requires as { metamodels?: Record<string, string> })?.metamodels ?? {}) : ((requires as Record<string, string>) ?? {});
      const origin = readOrigin(pkg.dir);
      const users = splsUsing({ workdir: workdirOf(session), pkg });
      data?.({ ...pkg, requires, offers: manifest.offers, usedBy: users, origin });
      const list = (rec: Record<string, string>) => Object.entries(rec).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing';
      return [
        `${kind} ${pkg.name}  v${pkg.version}${pkg.description ? `  — ${pkg.description}` : ''}`,
        `  folder:   ${displayPath(pkg.dir)}`,
        ...(origin ? [`  from:     ${origin.webUrl}`] : ['  from:     your workspace only (not published: publish it with: ' + `${noun} publish --to <group or owner>)`]),
        ...(kind === 'module' ? [`  needs:    modules: ${list(reqModules)}`, `            metamodels: ${list(reqMetamodels)}`, `  offers:   ${Object.keys(manifest.offers ?? {}).join(', ') || 'nothing'}`] : [`  needs:    ${list(reqMetamodels)}`]),
        `  used by:  ${users.length ? users.join(', ') : kind === 'module' ? 'no SPL of this workspace' : 'modules (a metamodel is only used through them)'}`,
      ].join('\n');
    },
  };

  const create: Command = {
    name: `${noun} new`,
    summary: `Create a ${noun} in your workspace`,
    usage: `${noun} new <name> [description…]`,
    run: ({ args, session }) => {
      const name = args[0];
      if (!name) return `Usage: ${noun} new <name> [description…]`;
      const pkg = createLocalPackage({ workdir: workdirOf(session), kind, name, description: args.slice(1).join(' ') || undefined });
      return `✓ Created ${kind} ${pkg.name} (v${pkg.version}) at ${displayPath(pkg.dir)}.\n  Edit it (open ${pkg.name}), check it (check ${pkg.name}), ${kind === 'module' ? 'use it from an SPL (spl add ' + pkg.name + '), ' : `require it from a ${other} (add it to requires.metamodels of its ${MANIFEST[other]}), `}publish it (${noun} publish ${pkg.name} --to <group or owner>).`;
    },
  };

  const clone: Command = {
    name: `${noun} clone`,
    hidden: true,
    summary: `Get a ${noun} of the git host into your workspace, to change it (get does it too: get gitlab:group/project)`,
    usage: `${noun} clone <gitlab:group/project|github:owner/repo> [--dir folder]`,
    flags: ['--dir folder'],
    run: async ({ args, session, setStatus }) => {
      const { positional, flags } = parseFlags(args, { value: { dir: undefined } });
      const m = LOCATION.exec(positional[0] ?? '');
      if (!m) return `Usage: ${noun} clone <gitlab:group/project|github:owner/repo> [--dir folder]   (${noun} list --remote shows them)`;
      const settings = gitSettings();
      setStatus(`cloning ${m[2]}…`);
      const got = await clonePackage({
        provider: gitProviderOf(settings),
        token: settings.token,
        kind,
        repoPath: m[2]!,
        workdir: workdirOf(session),
        ...(flagString(flags, 'dir') ? { dest: resolvePath(flagString(flags, 'dir')!) } : {}),
        helper: helperCommand(),
        onProgress: (said) => setStatus(`cloning ${m[2]}: ${said}`),
      });
      if (got.status === 'present') return `· ${got.name} is already here (${displayPath(got.dir)}): pull updates it`;
      return `✓ ${kind} ${got.name} → ${displayPath(got.dir)}${got.publishRoot ? `\n  ${noun} publish puts it back under ${got.publishRoot}` : ''}\n  Edit it, then: check ${got.name}  ·  ${noun} publish ${got.name} --bump patch`;
    },
  };

  const check: Command = {
    name: `${noun} check`,
    summary: `Check a ${noun} of your workspace on its own`,
    usage: `${noun} check [name]`,
    run: (ctx: CommandContext) => commandNamed('check').run(ctx),
  };

  const publish: Command = {
    name: `${noun} publish`,
    summary: `Check a ${noun} and publish its version to the git host, raising it first with --bump`,
    usage: `${noun} publish [name] [--bump patch|minor|major] [--to group-or-owner] [--dry-run] [--no-check]`,
    flags: ['--bump patch|minor|major', '--to group-or-owner', '--dry-run', '--no-check'],
    run: async (ctx) => {
      const { session } = ctx;
      const { positional, flags } = parseFlags(ctx.args, { value: { bump: undefined, to: undefined } });
      const workdir = workdirOf(session);
      const name = positional[0] ?? findContext(session.cwd ?? process.cwd()).package?.name;
      if (!name) return `Usage: ${noun} publish <name> [--bump patch|minor|major] [--to group-or-owner]`;
      const pkg = listLocalPackages(workdir).find((p) => p.kind === kind && p.name === name);
      if (!pkg) throw new Error(`No ${noun} "${name}" in ${displayPath(workdir)}. See: ${noun} list`);
      const dryRun = Boolean(flags['dry-run']);

      const root = flagString(flags, 'to') ?? readOrigin(pkg.dir)?.publishRoot;
      if (!root) {
        throw new Error(`Say where to publish it: ${noun} publish ${name} --to <group or owner>   (GitLab: a group that exists; GitHub: your user or organisation).`);
      }

      const bump = flagString(flags, 'bump');
      const next = bump ? nextVersion(pkg.version, bump) : pkg.version;

      if (!flags['no-check']) {
        const verdict = await commandNamed('check').run({ ...ctx, args: [name] });
        if (String(verdict).trimStart().startsWith('✗')) return `✗ Not published: ${name} does not pass its check (--no-check publishes anyway).\n${verdict}`;
      }
      if (bump && !dryRun) bumpPackageVersion({ dir: pkg.dir, kind, part: bump });

      const settings = gitSettings();
      const lines: string[] = [];
      const published = await publishFolder({
        provider: gitProviderOf(settings),
        token: settings.token,
        dir: path.dirname(path.dirname(pkg.dir)),
        root,
        kinds: [kind],
        only: name,
        dryRun,
        skipPublished: true,
        log: (line) => lines.push(line),
      });
      const p = published[0];
      if (!p) return `Nothing published: ${name} is not in ${displayPath(path.dirname(pkg.dir))}.`;
      const version = bump && dryRun ? `${pkg.version} → ${next}` : p.version;
      if (p.status === 'dry-run') return `… would publish ${kind} ${name} v${version} → ${p.path}\nDry run: nothing was written.`;
      if (p.status === 'already-published') return `· ${kind} ${name} v${p.version} is already published: raise the version (--bump patch) to publish a new one.`;
      return `✓ Published ${kind} ${name} v${p.version} → ${p.path}\n  Use it: spl add ${settings.config.provider}:${p.path}`;
    },
  };

  return [list, show, create, clone, check, publish];
}

function describeRemote(p: PackageSummary): string {
  return [
    `${p.kind} ${p.name}  ${p.latest ? `v${p.latest}` : 'unpublished'}${p.description ? `  — ${p.description}` : ''}`,
    `  location: ${p.location}`,
    `  versions: ${p.versions.map((v) => `v${v}`).join(', ') || 'none'}`,
    `  on:       ${p.webUrl}`,
    ...(p.readOnly ? ['  (listed for use: edited and published elsewhere)'] : []),
  ].join('\n');
}

// ---------------------------------------------------------------- spl update, product features

const splUpdate: Command = {
  name: 'spl update',
  summary: 'Take the newest versions the SPL’s ranges allow for its modules, and pin them ',
  usage: 'spl update [module]',
  run: async ({ args, session, data }) => {
    const lineDir = requireLine(session);
    if (!isModularLine(lineDir)) throw new Error('This SPL is not made of modules: there is nothing to update.');
    const only = args.find((a) => !a.startsWith('-'));
    const { changes, resolved } = await updateLocalLineLock(workdirOf(session), lineDir, only);
    data?.(changes);
    if (!changes.length) return `✓ Already on the newest versions (${resolved.modules.length} module(s), ${resolved.metamodels.length} metamodel(s)).`;
    const word = (c: { from?: string; to?: string }) => (c.from && c.to ? `${c.from} → ${c.to}` : c.to ? `new ${c.to}` : `dropped (was ${c.from})`);
    return [`✓ ${changes.length} change(s) pinned in linea.lock.json:`, ...changes.map((c) => `  ${c.location.replace(/^file:/, '')}  ${word(c)}`), '', 'Check them with: check   ·   send them with: push'].join('\n');
  },
};

const productFeatures: Command = {
  name: 'product features',
  summary: 'Show the features a product selects, or change them ',
  usage: 'product features [product] [--add A,B] [--remove C]',
  flags: ['--add A,B', '--remove C'],
  arg: 'product',
  run: async ({ args, session, data }) => {
    const { positional, flags } = parseFlags(args, { value: { add: undefined, remove: undefined } });
    const lineDir = requireLine(session);
    const name = positional[0];
    if (!name) return 'Usage: product features <product> [--add A,B] [--remove C]';
    const add = (flagString(flags, 'add') ?? '').split(',').filter(Boolean);
    const remove = (flagString(flags, 'remove') ?? '').split(',').filter(Boolean);
    if (!add.length && !remove.length) {
      const current = ((readLocalProductSpec(path.join(lineDir, name)) as { features?: string[] }).features ?? []).slice();
      data?.(current);
      return [`${name} selects ${current.length} feature(s):`, ...current.map((f) => `  ${f}`), '', 'See what exists with: fm show   ·   change with: product features ' + name + ' --add A,B --remove C'].join('\n');
    }
    // what is added has to be in the SPL's feature model
    const unknown = unknownFeatures(lineDir, add);
    if (unknown.length) throw new Error(`The feature model of ${path.basename(lineDir)} has no ${unknown.join(', ')}. See what exists with: fm show`);
    const { features: next, changed, spec: saved } = changeProductFeatures({ lineDir, name, add, remove });
    // the selection model follows the spec
    writeProductSelection(lineDir, path.join(lineDir, name), add);
    removeFromProductSelection(lineDir, path.join(lineDir, name), remove);
    data?.(next);
    return changed ? `✓ ${name} (v${saved.basicData?.version}) now selects: ${next.join(', ') || 'nothing'}.` : `· ${name} already selects that: nothing changed.`;
  },
};

export const packageCommands: Command[] = [...commandsFor('module'), ...commandsFor('metamodel'), splUpdate, productFeatures];
