import { nameOfLocation } from './locations'

// The choice of an SPL's modules or metamodels, as the pickers keep it: a list of `{ location, range }`.

/** The range a package is chosen with: anything from its latest version up, or any when it has none. */
export const rangeOf = (pkg) => (pkg?.latest ? `^${pkg.latest}` : '*')

/** `{ location: range }`, as the server takes a choice. */
export const toMap = (list) => Object.fromEntries(list.map((m) => [m.location, m.range.trim() || '*']))

export const isChosen = (chosen, location) => chosen.some((m) => m.location === location)

/** The choice with the package taken out when it is in, put in with its default range when it is not. */
export const toggled = (chosen, pkg) =>
  isChosen(chosen, pkg.location)
    ? chosen.filter((m) => m.location !== pkg.location)
    : [...chosen, { location: pkg.location, range: rangeOf(pkg) }]

export const withRange = (chosen, location, range) => chosen.map((m) => (m.location === location ? { ...m, range } : m))

/** The choice with the missing packages (`[{ location }]`) added, each with the default range of its entry in `catalog`. */
export const withMissing = (chosen, missing, catalog) => [
  ...chosen,
  ...missing.map((m) => ({ location: m.location, range: rangeOf(catalog.find((p) => p.location === m.location)) })),
]

/** The name of a package: the one the catalog gives it, or the last part of its location. */
export const nameIn = (catalog, location) => catalog.find((p) => p.location === location)?.name ?? nameOfLocation(location)

export const viewOptions = (t) => [
  { value: 'graph', label: t('modules.view_graph'), icon: 'pi pi-share-alt' },
  { value: 'list', label: t('modules.view_list'), icon: 'pi pi-list' },
]
