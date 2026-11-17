import { expressionOf, cronProblem, nextRun } from './cron.js';

export const BEHAVIORS = ['check', 'mr', 'merge'];

/**
 * What applies to a product: its own schedule when it has one, else its line's. `source` says which, for the UI
 * ("inherited" / "own"). The behavior (what a sync does with the drift it finds) is inherited on its own: a product can keep
 * the line's schedule and still decide what happens.
 */
export const effectiveSync = (product, line) => {
  const own = product?.sync ?? {};
  const base = line?.sync ?? {};
  const behavior = BEHAVIORS.includes(own.behavior) ? own.behavior : (base.behavior ?? 'mr');
  if (own.mode === 'off') return { enabled: false, source: 'product', behavior };
  if (own.mode === 'custom') return { enabled: true, source: 'product', preset: own.preset, cron: own.cron, behavior };
  return { enabled: Boolean(base.enabled), source: 'line', preset: base.preset, cron: base.cron, behavior };
};

/** When the scheduler should next sync this product after `from`, or `null` (it is off, or its schedule is not valid). */
export const nextSyncFor = (product, line, from = new Date()) => {
  const effective = effectiveSync(product, line);
  if (!effective.enabled) return null;
  const expression = expressionOf(effective);
  if (!expression || cronProblem(expression)) return null;
  return nextRun(expression, from);
};
