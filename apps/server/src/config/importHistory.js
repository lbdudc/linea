import ConfigImport from '../model/entities/configImport.js';

export const KEEP = 10;

/** Keeps an applied config with what it replaced; only the last `KEEP` are kept. */
export const rememberImport = async ({ userId, username, plan, applied }) => {
  const ok = new Set(applied.filter((result) => result.ok).map((result) => `${result.area}:${result.id}`));
  const done = plan.changes.filter((change) => ok.has(`${change.area}:${change.id}`));
  if (!done.length) return null;
  const entry = await ConfigImport.create({
    userId, username, results: applied,
    rows: done.map(({ area, id, rows }) => ({ area, id, rows })),
    before: done.map(({ area, id, before }) => ({ area, id, before })),
  });
  const old = await ConfigImport.find().sort({ at: -1 }).skip(KEEP).select('_id').lean();
  if (old.length) await ConfigImport.deleteMany({ _id: { $in: old.map((item) => item._id) } });
  return entry;
};

export const listImports = async () => (await ConfigImport.find().sort({ at: -1 }).limit(KEEP).lean()).map((entry) => ({
  id: String(entry._id), at: entry.at, by: entry.username ?? null, changes: entry.rows ?? [], failed: entry.results.filter((result) => !result.ok).length, rolledBackAt: entry.rolledBackAt ?? null,
}));

export const findImport = (id) => ConfigImport.findById(id);
