// Where modules and metamodels are in the app: each kind has its own list and its own detail page.
const SEGMENT = { module: 'modules', metamodel: 'metamodels' }

/** The list of a kind (`module` or `metamodel`). */
export const listPathOf = (kind) => `/packages/${SEGMENT[kind] ?? SEGMENT.module}`

/** The page of one package. */
export const pathOf = (kind, id) => `${listPathOf(kind)}/${id}`

/** The kind a path segment (`modules`, `metamodels`) stands for. */
export const kindOfSegment = (segment) => (segment === 'metamodels' ? 'metamodel' : 'module')
