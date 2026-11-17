import type { AnalysisMetric } from '@lbdudc/linea-core';
import { analyzeOffThread } from '../core/analysis.js';
import type { FeatureModelAnalysis, FeatureModelBddAnalysis } from '@lbdudc/linea-core';
import { readLocalModelAsUvl } from '../core/workspace.js';
import { commandNamed } from './lookup.js';
import { viewUvl } from '../core/uvlview.js';
import type { Command, DialogRow, DialogStep, DialogTone } from './types.js';
import { requireLine } from './util.js';

/** The feature model of the SPL you are in: its file, read and written here. LINEA gets it with `push`. */

/** Names for a line of the history: the first ones, and how many more (the panel has them all). */
const list = (v: unknown) =>
  Array.isArray(v) ? (v.length ? `${(v as unknown[]).slice(0, 10).join(', ')}${v.length > 10 ? `, … +${v.length - 10} more` : ''}` : '(none)') : '—';

/** Whether the BDD pass gave any number (a model too large for it skips them all). */
const hasMetrics = (r: Record<string, unknown>): boolean =>
  ['configsNumber', 'variability', 'homogeneity', 'uniqueFeatures', 'variantFeatures'].some((k) => r[k] !== undefined && r[k] !== null);

const show: Command = {
  name: 'fm show',
  summary: 'The feature model of the SPL as a tree: mandatory, optional, or and alternative features, and its constraints (--raw for the UVL file as it is)',
  usage: 'fm show [--raw]',
  run: ({ session, args, dialog }) => {
    const dir = requireLine(session);
    if (args.includes('--raw')) return readLocalModelAsUvl(dir);
    const view = viewUvl(readLocalModelAsUvl(dir));
    // in the window it is a panel to read and scroll; the tree is in the history too
    dialog?.({
      title: 'Feature model',
      command: 'fm show',
      rows: [
        { label: 'features', value: String(view.features), tone: 'info' },
        { label: 'constraints', value: String(view.constraints), tone: view.constraints ? 'warn' : 'dim' },
      ],
      lines: [view.legend, [], ...view.lines],
      footer: { text: `${view.features} features · ${view.constraints} constraints`, tone: 'dim' },
    });
    return view.text;
  },
};

const edit: Command = {
  name: 'fm edit',
  hidden: true,
  summary: 'Open the feature model in your editor (open fm)',
  usage: 'fm edit [--editor name]',
  run: (ctx) => commandNamed('open').run({ ...ctx, args: ['fm', ...ctx.args] }),
};

function formatBdd(r: Record<string, unknown>): string {
  const skipped = Array.isArray(r['_skipped']) ? (r['_skipped'] as unknown[]) : [];
  return [
    'Feature model BDD analysis:',
    `  Variability:   ${r['variability'] ?? '—'}`,
    `  Homogeneity:   ${r['homogeneity'] ?? '—'}`,
    `  Unique feats:  ${r['uniqueFeatures'] ?? '—'}`,
    `  Variant feats: ${r['variantFeatures'] ?? '—'}`,
    skipped.length ? `  Skipped:       ${skipped.join(', ')} (model too large — see ANALYSIS_THRESHOLDS)` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const analyze: Command = {
  name: 'fm analyze',
  summary: 'Analyse the feature model: satisfiable? core and dead features, number of configurations (--sat, --bdd)',
  usage: 'fm analyze [--sat] [--bdd]',
  cancellable: true,
  run: async ({ session, args, setStatus, dialog, signal }) => {
    const dir = requireLine(session);
    const command = `fm analyze${args.length ? ` ${args.join(' ')}` : ''}`;
    const onlyBdd = args.includes('--bdd');
    const mode = args.includes('--sat') ? 'SAT' : 'BDD';
    const title = onlyBdd ? 'Feature model analysis (BDD)' : `Feature model analysis (${mode})`;
    const started = Date.now();
    const steps: DialogStep[] = [];
    // in the window the work shows in a panel as it goes: each step, with its time, then what it found (and the history has it too)
    const show = (rows: DialogRow[] = [], footer?: { text: string; tone: DialogTone }): void =>
      dialog?.({ title, command, steps: steps.map((s) => ({ ...s })), rows, ...(footer ? { footer } : {}) });
    const step = async <T>(text: string, work: () => Promise<T> | T, detail: (r: T) => string, tolerate = false): Promise<T | undefined> => {
      const entry: DialogStep = { text, state: 'running' };
      steps.push(entry);
      setStatus(`${text}…`);
      show();
      const at = Date.now();
      try {
        const result = await work();
        entry.state = 'done';
        entry.detail = `${detail(result)}${detail(result) ? ' · ' : ''}${Date.now() - at}ms`;
        show();
        return result;
      } catch (e) {
        entry.state = 'fail';
        entry.detail = signal?.aborted ? 'cancelled' : ((e as Error).message.split('\n')[0] ?? 'failed');
        show();
        if (!tolerate) throw e;
        return undefined;
      }
    };

    try {
      await step('read the feature model', () => readLocalModelAsUvl(dir), (u) => `${u.split('\n').filter((l) => l.trim()).length} lines`);
      if (onlyBdd) {
        const r = (await step('BDD metrics', () => analyzeOffThread<FeatureModelBddAnalysis>({ kind: 'bdd', dir }, signal), () => '')) as unknown as Record<string, unknown>;
        show(bddRows(r), { text: `exit 0 · ${((Date.now() - started) / 1000).toFixed(1)}s`, tone: 'ok' });
        return formatBdd(r);
      }
      // the two passes do not depend on each other, and each has a thread: they run together, and the panel shows both going
      const main = step(
        `analysis (${mode})`,
        () => analyzeOffThread<FeatureModelAnalysis>({ kind: 'analyze', dir, mode }, signal),
        (a) => `${a._featureCount} features`,
      );
      // the BDD metrics (variability, homogeneity) are a second pass; a model that is too large for it gives none
      const bddPass =
        mode === 'BDD'
          ? (step(
              'variability metrics (BDD)',
              () => analyzeOffThread<FeatureModelBddAnalysis>({ kind: 'bdd', dir }, signal),
              (b) => (hasMetrics(b as unknown as Record<string, unknown>) ? '' : 'model too large for them: skipped'),
              true,
            ) as Promise<unknown>)
          : undefined;
      const r = (await main)!;
      const bdd = (await bddPass) as Record<string, unknown> | undefined;
      const variability = bdd && hasMetrics(bdd) ? bdd : undefined;

      const dead = names(r.deadFeatures);
      const falseOptional = names(r.falseOptionalFeatures);
      const rows: DialogRow[] = [
        { label: 'verdict', heading: true },
        { label: 'satisfiable', value: r.satisfiable === undefined ? '—' : r.satisfiable ? 'yes' : 'no', tone: r.satisfiable === false ? 'err' : 'ok' },
        { label: 'structure', heading: true },
        { label: 'features', value: `${r._featureCount} (${r._modelSize.replace('_', ' ')})` },
        { label: 'leaf features', value: count(r.leafNumber) },
        { label: 'max depth', value: count(r.maxDepth) },
        { label: 'branching factor', value: typeof r.averageBranchingFactor === 'number' ? r.averageBranchingFactor.toFixed(2) : count(r.averageBranchingFactor) },
        { label: 'atomic sets', value: Array.isArray(r.atomicSets) ? String(r.atomicSets.length) : '—' },
        { label: 'features by kind', heading: true },
        { label: 'core', items: names(r.coreFeatures), tone: 'ok' },
        { label: 'dead', items: dead, tone: dead.length ? 'err' : 'dim' },
        { label: 'false optional', items: falseOptional, tone: falseOptional.length ? 'warn' : 'dim' },
        ...(variability ? [{ label: 'variability', heading: true } as DialogRow, ...bddRows(variability).filter((x) => x.label !== 'configurations')] : []),
      ];
      const problems = r.satisfiable === false || dead.length > 0;
      show(rows, {
        text: `${problems ? 'problems found' : 'ok'} · ${((Date.now() - started) / 1000).toFixed(1)}s`,
        tone: problems ? 'err' : 'ok',
      });
      return [
        `Feature model analysis (${mode}):`,
        `  Satisfiable:   ${r.satisfiable ?? '—'}`,
        `  Core features: ${list(r.coreFeatures)}`,
        `  Dead features: ${list(r.deadFeatures)}`,
        `  Leaf count:    ${r.leafNumber ?? '—'}`,
        `  Features:      ${r._featureCount} (${r._modelSize})   depth ${r.maxDepth ?? '—'}   branching ${r.averageBranchingFactor ?? '—'}`,
        ...(falseOptional.length ? [`  False optional: ${list(r.falseOptionalFeatures)}`] : []),
        ...(variability ? [`  Variability:   ${variability['variability'] ?? '—'}   homogeneity ${variability['homogeneity'] ?? '—'}`] : []),
      ].join('\n');
    } catch (e) {
      if (steps.length === 0) dialog?.(null);
      else if (signal?.aborted) show([], { text: 'cancelled', tone: 'warn' });
      else show([], { text: 'failed', tone: 'err' });
      throw e;
    }
  },
};

const names = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const count = (v: unknown): string =>
  typeof v === 'number' || typeof v === 'bigint' ? v.toLocaleString('en-US') : v === undefined || v === null ? '—' : String(v);

/** The rows of the BDD analysis; variability and homogeneity are ratios and are drawn as bars. */
function bddRows(r: Record<string, unknown>): DialogRow[] {
  const ratio = (v: unknown): { ratio: number } | Record<string, never> => (typeof v === 'number' && v >= 0 && v <= 1 ? { ratio: v } : {});
  const skipped = names(r['_skipped']);
  const rows: DialogRow[] = [
    { label: 'variability', value: count(r['variability']), ...ratio(r['variability']) },
    { label: 'homogeneity', value: count(r['homogeneity']), ...ratio(r['homogeneity']) },
    { label: 'unique features', value: count(r['uniqueFeatures']) },
    { label: 'variant features', value: count(r['variantFeatures']) },
  ];
  if (skipped.length) rows.push({ label: 'too large, skipped', items: skipped, tone: 'warn' });
  return rows;
}

const metric: Command = {
  name: 'fm metric',
  summary: 'One metric of the feature model (satisfiable, deadFeatures, falseOptionalFeatures)',
  usage: 'fm metric <name> [--sat]',
  cancellable: true,
  run: async ({ session, args, setStatus, signal }) => {
    const dir = requireLine(session);
    const name = args.find((a) => !a.startsWith('--'));
    if (!name) return 'Usage: fm metric <satisfiable|deadFeatures|falseOptionalFeatures> [--sat]';
    setStatus('starting the analysis runtime (first run takes a few seconds)…');
    const r = (await analyzeOffThread({ kind: 'metric', dir, metric: name as AnalysisMetric, mode: args.includes('--sat') ? 'SAT' : 'BDD' }, signal)) as Record<string, unknown>;
    return `${name}: ${JSON.stringify(r[name] ?? null)}  (solver: ${r['_solveMode']})`;
  },
};

export const fmCommands: Command[] = [show, edit, analyze, metric];
