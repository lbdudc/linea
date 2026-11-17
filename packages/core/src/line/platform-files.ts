import fs from 'node:fs'
import { resolveAsset } from '../assets.js'

export interface FileSpec {
  readonly path: string
  readonly content: string
  readonly encoding: 'text' | 'base64'
}

const readTemplate = (...segments: string[]): string =>
  fs.readFileSync(resolveAsset({ segments: ['line', 'templates', ...segments] }), 'utf8')

/**
 * The platform files that every line has. What a product needs of its data model, its sensors and the rest is not here: those are
 * metamodels that the modules of an SPL bring, and their models are derived through each metamodel's own JSON mapping.
 */
export const buildExtraJs = (): string => readTemplate('core/extra.js')

export const buildTransformationJs = (): string => readTemplate('core/transformation.js')

/** The CI of the products an SPL generates: the pipeline file of the git host the SPL lives on, and the scripts it runs. */
/** `none`: the host runs no pipelines (the repositories kept on LINEA's own server), so there is no pipeline file; the scripts stay. */
export type CiHost = 'gitlab' | 'github' | 'none'

const CI_FILES: Record<Exclude<CiHost, 'none'>, { readonly path: string, readonly template: string }> = {
  gitlab: { path: 'src/platform/code/.gitlab-ci.yml', template: 'pipeline/.gitlab-ci.yml' },
  github: { path: 'src/platform/code/.github/workflows/ci.yml', template: 'pipeline/github-ci.yml' }
}

export const getPipelineFiles = ({ ci = 'gitlab' }: { ci?: CiHost } = {}): FileSpec[] => [
  ...(ci === 'none'
    ? []
    : [{ path: CI_FILES[ci].path, content: readTemplate(CI_FILES[ci].template), encoding: 'text' as const }]),
  {
    path: 'src/platform/code/ci/test-server.sh',
    content: readTemplate('pipeline/ci/test-server.sh'),
    encoding: 'text'
  },
  {
    path: 'src/platform/code/ci/test-client.sh',
    content: readTemplate('pipeline/ci/test-client.sh'),
    encoding: 'text'
  }
]

/**
 * The CI of the SPL repository itself (not of its products): what a merge request does to the products that exist. Only for GitLab so far;
 * a line that lives on GitHub gets none.
 */
export const getSplPipelineFiles = ({ ci = 'gitlab' }: { ci?: CiHost } = {}): FileSpec[] =>
  ci === 'gitlab'
    ? [{ path: '.gitlab-ci.yml', content: readTemplate('pipeline/spl-gitlab-ci.yml'), encoding: 'text' }]
    : []
