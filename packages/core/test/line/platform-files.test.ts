import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildExtraJs,
  buildTransformationJs,
  getPipelineFiles
} from '../../src/index.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TEMPLATES = path.join(ROOT, 'src', 'line', 'templates')
const template = (relative: string): string =>
  fs.readFileSync(path.join(TEMPLATES, relative), 'utf8')

const TEMPLATE_FILES = [
  'core/extra.js',
  'core/transformation.js',
  'pipeline/.gitlab-ci.yml',
  'pipeline/ci/test-server.sh',
  'pipeline/ci/test-client.sh'
]

describe('template assets', () => {
  it('ships every template the monolith factories read', () => {
    for (const relative of TEMPLATE_FILES) {
      expect(fs.existsSync(path.join(TEMPLATES, relative)), relative).toBe(true)
    }
  })

  it('no longer relies on the .gitkeep placeholder', () => {
    expect(fs.existsSync(path.join(TEMPLATES, '.gitkeep'))).toBe(false)
  })

  it('stores every template with LF endings, as the monolith deploys them', () => {
    for (const relative of TEMPLATE_FILES) {
      const raw = fs.readFileSync(path.join(TEMPLATES, relative), 'utf8')
      expect(raw.includes('\r'), `${relative} must not contain CR`).toBe(false)
    }
  })
})

describe('buildExtraJs and buildTransformationJs', () => {
  it('are the core templates: what a product needs of its data model or its sensors comes from the metamodels of its modules', () => {
    expect(buildExtraJs()).toBe(template('core/extra.js'))
    expect(buildTransformationJs()).toBe(template('core/transformation.js'))
  })

  it('no longer ship a data model or a sensor fragment', () => {
    expect(fs.existsSync(path.join(TEMPLATES, 'metamodels'))).toBe(false)
  })
})

describe('getPipelineFiles', () => {
  it('has no pipeline file for a host that runs none, and keeps the scripts', () => {
    expect(getPipelineFiles({ ci: 'none' }).map((file) => file.path)).toEqual([
      'src/platform/code/ci/test-server.sh',
      'src/platform/code/ci/test-client.sh'
    ])
  })

  it('returns the three files of PIPELINE_FILES, in order', () => {
    expect(getPipelineFiles().map((file) => file.path)).toEqual([
      'src/platform/code/.gitlab-ci.yml',
      'src/platform/code/ci/test-server.sh',
      'src/platform/code/ci/test-client.sh'
    ])
  })

  it('carries the template contents verbatim', () => {
    const files = getPipelineFiles()
    expect(files[0]?.content).toBe(template('pipeline/.gitlab-ci.yml'))
    expect(files[1]?.content).toBe(template('pipeline/ci/test-server.sh'))
    expect(files[2]?.content).toBe(template('pipeline/ci/test-client.sh'))
  })

  it('puts the CI in a GitHub Actions workflow for an SPL that lives on GitHub, with the same scripts', () => {
    const files = getPipelineFiles({ ci: 'github' })
    expect(files.map((file) => file.path)).toEqual([
      'src/platform/code/.github/workflows/ci.yml',
      'src/platform/code/ci/test-server.sh',
      'src/platform/code/ci/test-client.sh'
    ])
    expect(files[0]?.content).toBe(template('pipeline/github-ci.yml'))
    expect(files[0]?.content).toContain('sh ./ci/test-server.sh')
    expect(files[0]?.content).toContain('sh ./ci/test-client.sh')
  })

  it('marks every file as text', () => {
    for (const file of getPipelineFiles()) expect(file.encoding).toBe('text')
  })

  it('returns a fresh array each call, holding no module state', () => {
    const first = getPipelineFiles()
    const second = getPipelineFiles()
    expect(first).not.toBe(second)
    expect(first).toEqual(second)
  })
})
