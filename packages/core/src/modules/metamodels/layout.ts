/**
 * Where the files of a metamodel are in its package: one folder per kind, each file named after the grammar it belongs to.
 *
 *   grammars/<g>.langium       constraints/<g>.js      specs/<g>.js        imports/<g>.js
 *   scopes/<g>.js              visualizations/<g>.js   cases/<g>.json
 *
 * The same folders are in the metamodels repository and in bango's examples.
 */
export const METAMODEL_FOLDERS = {
  grammar: 'grammars',
  constraints: 'constraints',
  spec: 'specs',
  import: 'imports',
  scope: 'scopes',
  visualizations: 'visualizations',
  cases: 'cases'
} as const

export type MetamodelFileKind = keyof typeof METAMODEL_FOLDERS

const EXTENSIONS: Record<MetamodelFileKind, string> = {
  grammar: '.langium',
  constraints: '.js',
  spec: '.js',
  import: '.js',
  scope: '.js',
  visualizations: '.js',
  cases: '.json'
}

/** The path of a file of the grammar `grammar` in a package: `constraints/datamodel.js`. */
export const metamodelPath = ({ kind, grammar }: { kind: MetamodelFileKind, grammar: string }): string =>
  `${METAMODEL_FOLDERS[kind]}/${grammar}${EXTENSIONS[kind]}`

