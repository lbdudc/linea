import fs from 'node:fs';
import path from 'node:path';
import { flagString, parseFlags } from '../core/args.js';
import { splalm } from '../core/client.js';
import { changedCount, readOrigin, repoState } from '../core/gitops.js';
import { isModularLine, seedLocalProductModels } from '../core/workspace.js';
import {
  createLocalProduct,
  deleteLocalProduct,
  deriveLocalProductPreview,
  deriveLocalProductZip,
  generateLocalProduct,
  isLocalLineDir,
  listLocalProducts,
  localProductDir,
  readLocalProductSpec,
  renameLocalProduct,
  updateLocalProduct,
} from '../core/workspace.js';
import type { GenerateResult, ProductConflicts, SplalmLog } from '../core/types.js';
import { displayPath } from '../core/workdir.js';
import { isRepo } from '../core/gitops.js';
import type { Command, Session } from './types.js';
import { online } from '../core/mode.js';
import { describeProductModels } from './modules.js';
import { writeProductSelection } from '../core/selection.js';
import { requireLine, resolveProductName, workdirOf } from './util.js';

/**
 * The products of the SPL you are in, as folders. Everything here reads and writes those folders; LINEA gets the result with `push`.
 * What only the server can do (`generate --remote`, the logs and conflicts of its generations) takes the product's id from where
 * it was cloned from.
 */

const previews = (session: Session, ...segments: string[]): string => path.join(workdirOf(session), '.previews', ...segments);

const assertNotLineDir = (dir: string): void => {
  if (isLocalLineDir(dir)) throw new Error(`Refusing to write into "${dir}": it is an SPL. Pick a different path.`);
};

const list: Command = {
  name: 'product list',
  summary: 'The products of the SPL you are in',
  usage: 'product list [search]',
  run: ({ session, args, data }) => {
    const lineDir = requireLine(session);
    const all = listLocalProducts(lineDir).filter((p) => !args[0] || p.name.includes(args[0]));
    const rows = all.map((p) => ({ name: p.name, version: p.version, here: fs.existsSync(localProductDir(lineDir, p.name)) }));
    data?.(rows);
    if (!rows.length) return `No products${args[0] ? ` matching "${args[0]}"` : ''} in ${path.basename(lineDir)}. Make one with: product new <name>`;
    const width = Math.max(...rows.map((r) => r.name.length));
    return [
      `Products of ${path.basename(lineDir)} (${rows.length}):`,
      ...rows.map((r) => `  ${r.name.padEnd(width)}  v${r.version ?? '—'}${r.here ? '' : `   not here: get ${path.basename(lineDir)}:${r.name}`}`),
    ].join('\n');
  },
};

const show: Command = {
  name: 'product show',
  where: 'both',
  summary: 'One product: its features, languages, version, models, and what LINEA says of its merge requests',
  usage: 'product show [product]',
  arg: 'product',
  run: async ({ session, args }) => {
    const lineDir = requireLine(session);
    const name = resolveProductName(lineDir, args.find((a) => !a.startsWith('-')));
    const dir = localProductDir(lineDir, name);
    const origin = readOrigin(dir);
    if (!fs.existsSync(path.join(dir, '.linea', 'spec.json'))) {
      return [`Product: ${name}`, `  Folder:    ${displayPath(dir)}`, `  SPL:       ${path.basename(lineDir)}`, '  Spec:      none yet: LINEA has not generated it (select its features on LINEA, or here: product features)', `  LINEA:     ${origin ? origin.webUrl : '—'}`].join('\n');
    }
    const spec = readLocalProductSpec(dir);
    const lines = [
      `Product: ${spec.basicData?.name} (v${spec.basicData?.version})`,
      `  Folder:    ${displayPath(dir)}`,
      `  SPL:       ${path.basename(lineDir)}`,
      `  Languages: ${spec.basicData?.languages?.length ? spec.basicData.languages.join(', ') : '—'}`,
      `  Features:  ${(Array.isArray(spec.features) ? spec.features : []).join(', ') || '(none)'}`,
      `  LINEA:     ${origin ? origin.webUrl : 'not there yet (push the SPL, then get it)'}`,
    ];
    // what the SPL's modules ask of a product, and what the host says of its open merge requests: when there is something to say
    if (isModularLine(lineDir)) lines.push('', await describeProductModels(session, name));
    const merge = origin?.productId && online(session) ? await mergeRequestsOf(origin.productId) : undefined;
    if (merge) lines.push('', merge);
    return lines.join('\n');
  },
};

/** A product from a spec (the parsed JSON), in the SPL you are in. For one made of modules, with a starting model of each metamodel. */
export async function createProductFromSpec(session: Session, raw: unknown): Promise<string> {
  const lineDir = requireLine(session);
  const created = createLocalProduct({ lineDir, spec: raw });
  const seeded = await seedLocalProductModels(path.dirname(lineDir), lineDir, created.dir);
  // the selection model is where the features are chosen now: it starts from what the spec asks for
  const asked = (created.spec as { features?: string[] }).features ?? [];
  if (asked.length) writeProductSelection(lineDir, created.dir, asked);
  const models = seeded.length ? ` Starting models: ${seeded.join(', ')}: edit them and check ${created.name}.` : '';
  return `✓ Created ${created.name} at ${displayPath(created.dir)}.${models} Next: generate ${created.name}`;
}

const update: Command = {
  name: 'product update',
  hidden: true,
  summary: "Replace a product's spec with a file (product features changes the selection)",
  usage: 'product update <product> <spec.json>',
  arg: 'product',
  run: ({ session, args }) => {
    const lineDir = requireLine(session);
    const [first, second] = args.filter((a) => !a.startsWith('-'));
    // inside a product the name is filled in, so the file is the only word that is left
    const [target, file] = second ? [first, second] : [undefined, first];
    if (!file) return 'Usage: product update <product> <spec.json>';
    if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`Could not parse ${file} as JSON: ${(e as Error).message}`);
    }
    const name = resolveProductName(lineDir, target);
    const { spec } = updateLocalProduct({ lineDir, name, spec: raw });
    return `✓ Updated ${name} (v${spec.basicData?.version}).`;
  },
};

const rename: Command = {
  name: 'product rename',
  summary: 'Rename a product (on this machine)',
  usage: 'product rename <product> <new-name>',
  arg: 'product',
  run: ({ session, args }) => {
    const lineDir = requireLine(session);
    const [first, second] = args.filter((a) => !a.startsWith('-'));
    const [target, to] = second ? [first, second] : [undefined, first];
    if (!to) return 'Usage: product rename <product> <new-name>';
    const from = resolveProductName(lineDir, target);
    const onLinea = Boolean(readOrigin(localProductDir(lineDir, from)));
    const { dir } = renameLocalProduct(lineDir, from, to);
    return `✓ Renamed to ${to} (${displayPath(dir)}).${onLinea ? ' LINEA still knows it by the old name: rename it there too.' : ''}`;
  },
};

const del: Command = {
  name: 'product delete',
  summary: 'Delete a product from this machine (irreversible). LINEA keeps its own copy',
  usage: 'product delete <product> --yes',
  arg: 'product',
  run: ({ session, args }) => {
    const lineDir = requireLine(session);
    const name = resolveProductName(lineDir, args.find((a) => !a.startsWith('-')));
    if (!args.includes('--yes')) return `This permanently deletes the product "${name}" from this machine. Re-run with --yes to confirm.`;
    const onLinea = Boolean(readOrigin(localProductDir(lineDir, name)));
    deleteLocalProduct(lineDir, name);
    return `✓ Deleted "${name}" from this machine.${onLinea ? ' It is still on LINEA: delete it there in the web interface.' : ''}`;
  },
};

// ---------------------------------------------------------------- generate

/** The id LINEA knows a product by: where it was cloned from. */
export function remoteProductId(session: Session, name: string | undefined): string {
  const lineDir = requireLine(session);
  const product = resolveProductName(lineDir, name);
  const id = readOrigin(localProductDir(lineDir, product))?.productId;
  if (!id) throw new Error(`${product} is not on LINEA yet (it was not cloned from there). Push the SPL, then: get ${path.basename(lineDir)}:${product}`);
  return id;
}

const generate: Command = {
  name: 'generate',
  summary: 'Derive a product here (--preview <dir> and --zip leave it alone), or on LINEA with --remote',
  usage: 'generate [product] [--preview [dir]] [--zip [file.zip]] [--remote [--bump patch|minor|major] [--no-wait]]',
  flags: ['--preview dir', '--zip file.zip', '--remote', '--bump part', '--no-wait'],
  arg: 'product',
  run: async ({ session, args, setStatus }) => {
    const { positional, flags } = parseFlags(args, {
      optional: { preview: undefined, zip: undefined },
      value: { bump: undefined },
      bool: { remote: undefined, 'no-wait': undefined },
    });
    const lineDir = requireLine(session);
    const name = resolveProductName(lineDir, positional[0]);
    const productDir = localProductDir(lineDir, name);

    // LINEA derives it from what LINEA has, and opens the merge requests: what is only here is not in it
    if (flags['remote']) {
      const id = remoteProductId(session, name);
      const unsent = isRepo(productDir) ? changedCount(repoState(productDir)) : 0;
      const bump = flagString(flags, 'bump');
      if (bump !== undefined && !BUMPS.includes(bump)) throw new Error(`--bump is one of ${BUMPS.join(', ')} (it was "${bump}").`);
      setStatus('generating on LINEA (can take several minutes)…');
      const result = (await splalm.post(`/api/products/${id}/generate`, bump ? { bump } : undefined)) as GenerateResult;
      const note = unsent ? `\n! ${unsent} change(s) of yours in ${name} are not on LINEA: push them first, and generate again.` : '';
      if (result.conflicts) return `! Generated with conflicts at stage "${result.stage}". Resolve the merge request:\n  ${result.mergeRequestUrl}${note}`;
      const version = result.spec?.basicData.version;
      const head = `✓ Generated on LINEA${version ? ` (v${version})` : ''}: its merge request is waiting there. Next: get, to bring it here.${note}`;
      if (flags['no-wait']) return `${head}\n  Follow the deployment with: product pipeline ${name}`;
      setStatus('following the pipeline…');
      return `${head}\n\n${await followPipeline(id, setStatus)}`;
    }

    if (flags['zip'] !== undefined) {
      const spec = readLocalProductSpec(productDir);
      const out = path.resolve(flagString(flags, 'zip') ?? previews(session, `${name}-${spec.basicData?.version ?? '0.0.0'}.zip`));
      setStatus('deriving the zip…');
      const buffer = await deriveLocalProductZip(lineDir, spec);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buffer);
      return `✓ Wrote ${displayPath(out)} (the product itself is unchanged).`;
    }

    if (flags['preview'] !== undefined) {
      const dir = path.resolve(flagString(flags, 'preview') ?? previews(session, name));
      assertNotLineDir(dir);
      setStatus('deriving the product (a preview: nothing else changes)…');
      const { outputDir } = await deriveLocalProductPreview({ lineDir, spec: readLocalProductSpec(productDir), outputDir: dir });
      return `✓ Generated into ${displayPath(outputDir)} (a preview: spec and version unchanged).`;
    }

    setStatus('deriving the product…');
    const { outputDir, version } = await generateLocalProduct(lineDir, name);
    return `✓ Generated ${name} (v${version}) into ${displayPath(outputDir)}. Next: look at what changed, then push.`;
  },
};

// ---------------------------------------------------------------- what only the server has

const logs: Command = {
  name: 'product logs',
  summary: 'The logs of LINEA generating a product: the versions, or one version',
  usage: 'product logs [product] [version]',
  requiresAuth: true,
  arg: 'product',
  run: async ({ session, args }) => {
    const [first, version] = args.filter((a) => !a.startsWith('-'));
    // inside a product the name is filled in; `product logs 1.2.0` from outside names the product first
    const id = remoteProductId(session, first);
    if (!version) {
      const versions = (await splalm.get(`/api/logs/${id}/versions`)) as string[];
      return versions.length ? ['Versions:', ...versions.map((v) => `  ${v}`), '', 'Show one with: product logs <product> <version>'].join('\n') : 'No generation logs yet.';
    }
    const entries = (await splalm.get(`/api/logs/${id}/${version}`)) as SplalmLog[];
    if (!entries.length) return 'No log entries for that version.';
    const icon = (t: string) => (t === 'error' ? '✗' : t === 'warning' ? '!' : t === 'success' ? '✓' : '·');
    return entries.map((l) => `${icon(l.type)} ${l.message}${l.params?.length ? ` (${l.params.join(', ')})` : ''}${l.link ? `\n    ${l.link}` : ''}`).join('\n');
  },
};

/** The open and conflicting merge requests of a product on LINEA, in words; nothing when the server does not answer. */
async function mergeRequestsOf(productId: string): Promise<string | undefined> {
  try {
    const c = (await splalm.get(`/api/products/${productId}/conflicts`)) as ProductConflicts;
    if (c.conflictingMRs > 0) return `! ${c.conflictingMRs} conflicting merge request(s) of ${c.openMRs} open.`;
    return c.openMRs > 0 ? `${c.openMRs} open merge request(s), none conflicting.` : undefined;
  } catch {
    return undefined;
  }
}

const conflicts: Command = {
  name: 'product conflicts',
  hidden: true,
  summary: 'The open and conflicting merge requests of a product on LINEA (product show has them too)',
  usage: 'product conflicts [product]',
  requiresAuth: true,
  arg: 'product',
  run: async ({ session, args }) => {
    const c = (await splalm.get(`/api/products/${remoteProductId(session, args.find((a) => !a.startsWith('-')))}/conflicts`)) as ProductConflicts;
    if (c.conflictingMRs > 0) return `! ${c.conflictingMRs} conflicting merge request(s) of ${c.openMRs} open.`;
    return c.openMRs > 0 ? `${c.openMRs} open merge request(s), none conflicting.` : 'No open merge requests.';
  },
};

// ---------------------------------------------------------------- the deployment of a version

const BUMPS = ['patch', 'minor', 'major'];
const FINAL_STATUSES = ['success', 'failed', 'canceled', 'skipped'];
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface PipelineAnswer {
  pipeline: { id?: string | number; status: string; webUrl: string; createdAt: string; ref: string } | null;
  jobs: Array<{ id: string | number; name: string; stage: string; status: string; duration: number | null }>;
  failed: { id: string | number; name: string; trace: string } | null;
}

const statusIcon = (status: string): string => (status === 'success' ? '✓' : status === 'failed' ? '✗' : status === 'running' ? '…' : status === 'skipped' || status === 'canceled' ? '–' : '·');

/** The pipeline in words: its state, one line per job, and what the failed one printed last. */
export function describePipeline(answer: PipelineAnswer): string {
  if (!answer.pipeline) return 'No pipeline has run for this product yet.';
  const { pipeline, jobs, failed } = answer;
  const lines = [`Pipeline ${statusIcon(pipeline.status)} ${pipeline.status}  ${pipeline.webUrl}`];
  const width = Math.max(0, ...jobs.map((j) => j.name.length));
  for (const job of jobs) {
    lines.push(`  ${statusIcon(job.status)} ${job.name.padEnd(width)}  ${job.status.padEnd(8)} ${job.duration === null ? '' : `${job.duration}s`}`);
  }
  if (failed?.trace) lines.push('', `  ✗ ${failed.name} printed:`, ...failed.trace.split('\n').map((l) => `    ${l}`));
  return lines.join('\n');
}

/** Looks at the pipeline until it ends (or `timeoutMs`), and says how it went. */
async function followPipeline(id: string, setStatus: (s: string) => void, timeoutMs = 5 * 60_000): Promise<string> {
  const started = Date.now();
  let answer: PipelineAnswer = { pipeline: null, jobs: [], failed: null };
  while (Date.now() - started < timeoutMs) {
    answer = (await splalm.get(`/api/products/${id}/pipeline`)) as PipelineAnswer;
    if (answer.pipeline && FINAL_STATUSES.includes(answer.pipeline.status)) return describePipeline(answer);
    const jobs = (answer.jobs ?? []).filter((j) => j.status === 'success').length;
    setStatus(answer.pipeline ? `pipeline ${answer.pipeline.status} (${jobs}/${answer.jobs.length} jobs)…` : 'waiting for the pipeline to start…');
    // a product without CI never gets one: the first minute is enough to say so
    if (!answer.pipeline && Date.now() - started > 60_000) return 'No pipeline started for the commit (does the project have CI?).';
    await wait(3000);
  }
  return `${describePipeline(answer)}\n  (still not finished: look again with: product pipeline)`;
}

const pipeline: Command = {
  name: 'product pipeline',
  summary: 'The pipeline of the last commit of a product on LINEA: its jobs and, when one failed, what it printed. --retry runs it again',
  usage: 'product pipeline [product] [--retry] [--watch]',
  flags: ['--retry', '--watch'],
  requiresAuth: true,
  arg: 'product',
  run: async ({ session, args, setStatus }) => {
    const { positional, flags } = parseFlags(args, { bool: { retry: undefined, watch: undefined } });
    const id = remoteProductId(session, positional[0]);
    if (flags['retry']) {
      await splalm.post(`/api/products/${id}/pipeline/retry`);
      setStatus('following the pipeline…');
      return `✓ Running the failed jobs again.\n\n${await followPipeline(id, setStatus)}`;
    }
    if (flags['watch']) return followPipeline(id, setStatus);
    return describePipeline((await splalm.get(`/api/products/${id}/pipeline`)) as PipelineAnswer);
  },
};

interface VersionSnapshot {
  version: string;
  spec: { features?: string[]; basicData?: { version?: string } };
  models?: Record<string, string>;
  previous?: { version: string; spec: VersionSnapshot['spec']; models?: Record<string, string> } | null;
}

const newestOf = (versions: string[]): string | undefined => {
  const parts = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  return [...versions].sort((a, b) => {
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  }).at(-1);
};

/** What a version changed against the one before it: the features, and the models that are not what they were. */
export function describeChanges(snapshot: VersionSnapshot): string {
  const after = snapshot.spec;
  const before = snapshot.previous?.spec;
  const from = snapshot.previous ? `v${snapshot.previous.version}` : '(nothing)';
  const lines = [`v${snapshot.version}  ←  ${from}`];
  if (!snapshot.previous) lines.push('  First generation: there is no version before it to compare with.');
  const now = new Set(after.features ?? []);
  const was = new Set(before?.features ?? []);
  const added = [...now].filter((f) => !was.has(f)).sort();
  const removed = [...was].filter((f) => !now.has(f)).sort();
  if (added.length || removed.length) {
    lines.push('  Features:');
    lines.push(...added.map((f) => `    + ${f}`), ...removed.map((f) => `    - ${f}`));
  }
  const newModels = snapshot.models ?? {};
  const oldModels = snapshot.previous?.models ?? {};
  const changed = [...new Set([...Object.keys(newModels), ...Object.keys(oldModels)])].sort().filter((n) => (newModels[n] ?? '') !== (oldModels[n] ?? ''));
  if (snapshot.previous && changed.length) {
    lines.push('  Models:');
    for (const name of changed) {
      const [a, b] = [(oldModels[name] ?? '').split('\n'), (newModels[name] ?? '').split('\n')];
      const gone = a.filter((l) => !b.includes(l)).length;
      const came = b.filter((l) => !a.includes(l)).length;
      lines.push(`    ~ ${name}  (+${came} −${gone} lines)`);
    }
  }
  if (lines.length === 1 || (lines.length === 2 && !snapshot.previous)) lines.push('  No changes in the specification.');
  return lines.join('\n');
}

const changes: Command = {
  name: 'product changes',
  summary: 'What a version of a product changed in its specification against the one before it (the last one when none is given)',
  usage: 'product changes [product] [version]',
  requiresAuth: true,
  arg: 'product',
  run: async ({ session, args }) => {
    const [first, second] = args.filter((a) => !a.startsWith('-'));
    // `product changes 1.2.0` inside a product names the version; from outside, the product first
    const versionLike = (w: string | undefined) => (w ? /^\d+\.\d+\.\d+$/.test(w) : false);
    const [name, version] = versionLike(first) && !second ? [undefined, first] : [first, second];
    const id = remoteProductId(session, name);
    const target = version ?? newestOf((await splalm.get(`/api/logs/${id}/versions`)) as string[]);
    if (!target) return 'No version of this product was generated on LINEA yet.';
    return describeChanges((await splalm.get(`/api/products/${id}/versions/${target}`)) as VersionSnapshot);
  },
};

const rollback: Command = {
  name: 'product rollback',
  summary: 'Go back to the content of an earlier version: it is restored and generated on LINEA as a new version (history is not rewritten)',
  usage: 'product rollback <version> [product] [--no-generate]',
  flags: ['--no-generate'],
  requiresAuth: true,
  arg: 'product',
  run: async ({ session, args, setStatus }) => {
    const { positional, flags } = parseFlags(args, { bool: { 'no-generate': undefined } });
    const [version, name] = positional;
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Which version? product rollback <version> [product]  (see: product logs)');
    const id = remoteProductId(session, name);
    setStatus(`restoring v${version}…`);
    await splalm.post(`/api/products/${id}/versions/${version}/restore`);
    if (flags['no-generate']) return `✓ Restored the content of v${version} as the saved one. Generate it with: generate --remote`;
    setStatus('generating on LINEA (can take several minutes)…');
    const result = (await splalm.post(`/api/products/${id}/generate`)) as GenerateResult;
    if (result.conflicts) return `! Restored v${version}, but generating it has conflicts. Resolve the merge request:\n  ${result.mergeRequestUrl}`;
    const made = result.spec?.basicData.version;
    return `✓ The content of v${version} is now ${made ? `v${made}` : 'a new version'} on LINEA.\n\n${await followPipeline(id, setStatus)}`;
  },
};

interface DeploymentAnswer {
  version: string | null;
  deployedAt?: string | null;
  deployed: { features?: string[] } | null;
  saved: { features?: string[] } | null;
}

const deployment: Command = {
  name: 'product deployment',
  summary: 'What is saved on LINEA that no generation has put in the code of the product yet',
  usage: 'product deployment [product]',
  requiresAuth: true,
  arg: 'product',
  run: async ({ session, args }) => {
    const id = remoteProductId(session, args.find((a) => !a.startsWith('-')));
    const d = (await splalm.get(`/api/products/${id}/deployment`)) as DeploymentAnswer;
    if (!d.version) return 'Never generated on LINEA: everything saved is pending. Next: generate --remote';
    if (!d.deployed) return `Last generated: v${d.version} (its specification was not kept, so nothing can be compared).`;
    const now = new Set(d.saved?.features ?? []);
    const was = new Set(d.deployed.features ?? []);
    const added = [...now].filter((f) => !was.has(f));
    const removed = [...was].filter((f) => !now.has(f));
    if (!added.length && !removed.length && JSON.stringify(d.saved) === JSON.stringify(d.deployed)) return `✓ Up to date: what is saved is what v${d.version} derived from.`;
    return [`Saved changes not generated yet (since v${d.version}):`, ...added.map((f) => `  + ${f}`), ...removed.map((f) => `  - ${f}`), '', 'Next: generate --remote'].join('\n');
  },
};

export const productCommands: Command[] = [list, show, update, rename, del, generate, logs, conflicts, pipeline, changes, rollback, deployment];
