import path from 'node:path'
import { NAME_PATTERN } from '../constants.js'
import { InvalidArgumentError } from '../errors.js'
import { ensureDir, writeTextFile } from '../fs/workspace.js'
import { FEATURE_METAMODEL, FEATURE_MODEL_GRAMMAR, withFeatureMetamodel } from '../modules/configuration/constants.js'
import { bangoName, rootFeatureName } from '../modules/configuration/names.js'
import { serializeSplManifest } from '../modules/packages/manifests.js'
import type { SplKind, SplManifest } from '../modules/types.js'
import { buildExtraJs, buildTransformationJs, getPipelineFiles, type CiHost, type FileSpec } from './platform-files.js'

export const DEFAULT_PLATFORM_CONFIG = {
  ignore: ['target', 'bower_components', '.gradle', '.project', 'bin', 'build', '.settings', '.classpath'],
  delimiters: [
    { extension: ['html', 'jsp', 'xml'], start: '<!--%', end: '%-->' },
    {
      extension: [
        'css', 'js', 'java', 'vue', 'g4', 'tokens', 'gradle', 'md', 'conf',
        'gitignore', 'properties', 'sql', 'env', 'production'
      ],
      start: '/*%',
      end: '%*/'
    },
    { extension: ['py'], start: '#%', end: '%#' },
    { extension: ['json'], start: '###<', end: '>###' }
  ]
} as const

export const DEFAULT_CODE_GITIGNORE = 'node_modules/\ntarget/\ndist/\n.env\n*.log\n'

/** The first feature model of an SPL, as a model of the feature metamodel: just the root, named after the SPL. */
export const emptyFeatureModel = ({ name }: { name: string }): string => {
  const root = bangoName({ name: rootFeatureName({ name }) })
  return `featuremodel ${root}\nfeature ${root}\n`
}

/** Where an SPL keeps its feature model. */
export const FEATURE_MODEL_PATH = `models/${FEATURE_MODEL_GRAMMAR}.${FEATURE_MODEL_GRAMMAR}`

export interface LineScaffoldInput {
  name: string
  /** `plain` (the default): the feature metamodel only. `project`: also the `metamodels` the user chose. `modular`: made of `modules`. */
  kind?: SplKind
  /** The metamodels of a `project` (location -> range), besides the feature metamodel. */
  metamodels?: Record<string, string>
  /** The modules of a `modular` SPL (location -> range). */
  modules?: Record<string, string>
  /** Where the feature metamodel is, when not in the default registry (a workspace on disk has it as `file:metamodels/featuremodel`). */
  featureMetamodel?: string
  /** The git host the SPL will live on: which CI file the generated products get (default `gitlab`). */
  ci?: CiHost
}

/** The `spl.json` of a new SPL. */
export const buildSplManifest = ({ name, kind = 'plain', metamodels = {}, modules = {}, featureMetamodel }: LineScaffoldInput): SplManifest =>
  withFeatureMetamodel({
    spl: { name, version: '1.0.0', kind, metamodels: kind === 'project' ? metamodels : {}, modules: kind === 'modular' ? modules : {} },
    ...(featureMetamodel === undefined ? {} : { location: featureMetamodel })
  })

/**
 * The files of a new SPL: its manifest, its feature model (a model of the feature metamodel), and, for a plain or project SPL, the platform
 * its products are derived with (a modular one gets it from its modules).
 */
export const buildLineScaffold = ({ name, kind = 'plain', metamodels, modules, featureMetamodel, ci = 'gitlab' }: LineScaffoldInput): FileSpec[] => {
  if (typeof name !== 'string' || name === '') {
    throw new InvalidArgumentError('"name" must be a non-empty string.')
  }
  if (!NAME_PATTERN.test(name)) {
    throw new InvalidArgumentError(
      `Invalid line name ${JSON.stringify(name)}: allowed characters are [a-zA-Z0-9_.-].`
    )
  }

  const own: FileSpec[] = [
    { path: 'spl.json', content: serializeSplManifest({ spl: buildSplManifest({ name, kind, ...(metamodels === undefined ? {} : { metamodels }), ...(modules === undefined ? {} : { modules }), ...(featureMetamodel === undefined ? {} : { featureMetamodel }) }) }), encoding: 'text' },
    { path: FEATURE_MODEL_PATH, content: emptyFeatureModel({ name }), encoding: 'text' }
  ]
  if (kind === 'modular') return own

  return [
    ...own,
    {
      path: 'src/platform/config.json',
      content: JSON.stringify(DEFAULT_PLATFORM_CONFIG, null, 2),
      encoding: 'text'
    },
    { path: 'src/platform/code/.gitignore', content: DEFAULT_CODE_GITIGNORE, encoding: 'text' },
    { path: 'src/platform/extra.js', content: buildExtraJs(), encoding: 'text' },
    {
      path: 'src/platform/transformation.js',
      content: buildTransformationJs(),
      encoding: 'text'
    },
    ...getPipelineFiles({ ci })
  ]
}

export const writeLineScaffold = ({ dir, ...rest }: LineScaffoldInput & { dir: string }): { dir: string, files: FileSpec[] } => {
  if (typeof dir !== 'string' || dir.trim() === '') {
    throw new InvalidArgumentError('"dir" must be a non-empty path.')
  }
  const files = buildLineScaffold(rest)
  const root = ensureDir({ dirPath: dir })

  for (const file of files) {
    writeTextFile({ filePath: path.join(root, ...file.path.split('/')), content: file.content })
  }

  return { dir: root, files }
}

export { FEATURE_METAMODEL }
