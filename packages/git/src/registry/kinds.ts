import { parseMetamodelManifest, parseModuleManifest } from '@lbdudc/linea-core'

export type PackageKind = 'module' | 'metamodel'

/** What a module or a metamodel is in the registry: how it is found (its topic), described (its manifest) and started (its scaffold). */
export interface KindDefinition {
  kind: PackageKind
  /** The folder of a workspace that holds the packages of this kind. */
  dir: string
  topic: string
  manifest: string
  parse: (args: { content: string }) => unknown
  scaffold: (args: { name: string, description?: string | undefined }) => Record<string, string>
}

/** `user-management` -> `UserManagement`: the name of a root feature or of a grammar rule. */
export const pascal = (name: string): string =>
  name.replace(/(^|[-_.\s]+)(.)/g, (_match, _sep, char: string) => char.toUpperCase()).replace(/[^A-Za-z0-9_]/g, '') || 'Root'

const moduleKind: KindDefinition = {
  kind: 'module',
  dir: 'modules',
  topic: 'linea-module',
  manifest: '.linea/module.json',
  parse: parseModuleManifest,
  scaffold: ({ name, description }) => ({
    '.linea/module.json': `${JSON.stringify({ name, version: '0.1.0', ...(description ? { description } : {}), requires: { modules: {}, metamodels: {} }, offers: {} }, null, 2)}\n`,
    '.linea/model.uvl': `features\n\t${pascal(name)}\n`
  })
}

const metamodelKind: KindDefinition = {
  kind: 'metamodel',
  dir: 'metamodels',
  topic: 'linea-metamodel',
  manifest: 'metamodel.json',
  parse: parseMetamodelManifest,
  scaffold: ({ name, description }) => {
    const rule = pascal(name)
    return {
      'metamodel.json': `${JSON.stringify({ name, version: '0.1.0', ...(description ? { description } : {}), requires: {} }, null, 2)}\n`,
      [`grammars/${name}.langium`]: [
        `grammar ${rule}`,
        '',
        `// ${description || `${rule}: describe what this metamodel models`}`,
        `entry ${rule}Model: '${name.toLowerCase()}' name=ID? (items+=Item)*;`,
        '',
        "Item: 'item' name=ID;",
        '',
        'terminal ID: /[_a-zA-Z][\\w_-]*/;',
        'hidden terminal WS: /\\s+/;',
        ''
      ].join('\n')
    }
  }
}

/** The two registries of packages. They are separate: each has its own definition, and nothing in one refers to the other. */
export const KIND_DEFINITIONS: Record<PackageKind, KindDefinition> = { module: moduleKind, metamodel: metamodelKind }
export const KINDS: PackageKind[] = ['module', 'metamodel']
