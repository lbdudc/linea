import { absoluteRequires } from '@lbdudc/linea-core';

/**
 * The packages of a resolution, as the client shows them. For each one, what it asks for directly (`needs`) and, for a module, the
 * models it offers: that is what says why a set of modules is valid (or not), module by module.
 */
export const summarizeResolved = (resolved) => {
  const byLocation = new Map([...resolved.modules, ...resolved.metamodels].map((pkg) => [pkg.location, pkg]));
  const brief = (location) => {
    const pkg = byLocation.get(location);
    return { location, name: pkg?.manifest.name ?? location.replace(/^gitlab:/, ''), version: pkg?.version ?? null };
  };
  return [...resolved.modules, ...resolved.metamodels].map((pkg) => {
    const needs = absoluteRequires({ kind: pkg.kind, location: pkg.location, manifest: pkg.manifest });
    return {
      kind: pkg.kind,
      location: pkg.location,
      name: pkg.manifest.name,
      version: pkg.version,
      description: pkg.manifest.description ?? '',
      requiredBy: pkg.requiredBy,
      needs: { modules: Object.keys(needs.modules).map(brief), metamodels: Object.keys(needs.metamodels).map(brief) },
      offers: pkg.kind === 'module' ? Object.keys(pkg.manifest.offers) : [],
    };
  });
};
