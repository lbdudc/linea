/**
 * The modules a choice needs and does not have. The server resolves what the chosen modules require, so the packages of its answer include
 * the modules nobody chose: each of those is a missing module (with who needs it), to be reported and added, not brought in silently.
 */
export const missingModules = ({ packages, chosen, nameOf }) =>
  (packages ?? [])
    .filter((p) => p.kind === 'module' && !chosen.some((m) => m.location === p.location))
    .map((p) => ({
      location: p.location,
      name: p.name,
      version: p.version,
      by: [...new Set(p.requiredBy.filter((r) => r !== 'spl').map((r) => nameOf(r.replace(/@.*$/, ''))))],
    }))
