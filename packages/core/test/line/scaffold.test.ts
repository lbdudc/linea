import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildExtraJs,
  buildLineScaffold,
  buildSplManifest,
  buildTransformationJs,
  DEFAULT_CODE_GITIGNORE,
  DEFAULT_PLATFORM_CONFIG,
  emptyFeatureModel,
  FEATURE_METAMODEL,
  FEATURE_MODEL_PATH,
  InvalidArgumentError,
  parseSplManifest,
  writeLineScaffold
} from '../../src/index.js'

const created: string[] = []
const makeTmpDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-core-scaffold-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  vi.restoreAllMocks()
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const PLATFORM = [
  'src/platform/config.json',
  'src/platform/code/.gitignore',
  'src/platform/extra.js',
  'src/platform/transformation.js',
  'src/platform/code/.gitlab-ci.yml',
  'src/platform/code/ci/test-server.sh',
  'src/platform/code/ci/test-client.sh'
]

const paths = (input: Parameters<typeof buildLineScaffold>[0]): string[] => buildLineScaffold(input).map((file) => file.path)
const file = (input: Parameters<typeof buildLineScaffold>[0], at: string): string | undefined => buildLineScaffold(input).find((f) => f.path === at)?.content

describe('the three kinds of SPL', () => {
  it('a plain one has the feature metamodel only, its feature model, and the platform its products are derived with', () => {
    expect(paths({ name: 'L' })).toEqual(['spl.json', FEATURE_MODEL_PATH, ...PLATFORM])
    const spl = parseSplManifest({ content: file({ name: 'L' }, 'spl.json')! })
    expect(spl).toMatchObject({ name: 'L', kind: 'plain', modules: {}, metamodels: { [FEATURE_METAMODEL.location]: FEATURE_METAMODEL.range } })
  })

  it('a project has the metamodels the user chose besides the feature metamodel, which it always has', () => {
    const input = { name: 'L', kind: 'project' as const, metamodels: { 'gitlab:linea/metamodels/datamodel': '^2.0.0' } }
    expect(paths(input)).toEqual(['spl.json', FEATURE_MODEL_PATH, ...PLATFORM])
    expect(parseSplManifest({ content: file(input, 'spl.json')! }).metamodels).toEqual({
      'gitlab:linea/metamodels/datamodel': '^2.0.0',
      [FEATURE_METAMODEL.location]: FEATURE_METAMODEL.range
    })
  })

  it('a modular one has its modules, and its platform comes from them', () => {
    const input = { name: 'L', kind: 'modular' as const, modules: { 'gitlab:linea/modules/main-component': '^0.4.0' } }
    expect(paths(input)).toEqual(['spl.json', FEATURE_MODEL_PATH])
    const spl = parseSplManifest({ content: file(input, 'spl.json')! })
    expect(spl.kind).toBe('modular')
    expect(spl.modules).toEqual({ 'gitlab:linea/modules/main-component': '^0.4.0' })
    expect(Object.keys(spl.metamodels)).toEqual([FEATURE_METAMODEL.location])
  })

  it('a plain or project SPL cannot be given modules, nor a plain one metamodels of its own', () => {
    expect(buildSplManifest({ name: 'L', kind: 'plain', modules: { x: '^1.0.0' }, metamodels: { y: '^1.0.0' } })).toMatchObject({ modules: {}, metamodels: { [FEATURE_METAMODEL.location]: FEATURE_METAMODEL.range } })
  })

  it('says where the feature metamodel is when the host has it somewhere else', () => {
    const spl = buildSplManifest({ name: 'L', featureMetamodel: 'file:metamodels/featuremodel' })
    expect(spl.metamodels).toEqual({ 'file:metamodels/featuremodel': FEATURE_METAMODEL.range })
  })
})

describe('the feature model of a new SPL', () => {
  it('is a model of the feature metamodel: the root alone, named after the SPL', () => {
    expect(file({ name: 'QA-Mono.2' }, FEATURE_MODEL_PATH)).toBe('featuremodel QAMono2\nfeature QAMono2\n')
    expect(emptyFeatureModel({ name: 'shop' })).toBe('featuremodel Shop\nfeature Shop\n')
  })

  it('has its name between quotes when it is a word of the metamodel, or does not start like a name', () => {
    expect(emptyFeatureModel({ name: 'select' })).toBe('featuremodel Select\nfeature Select\n')
    expect(emptyFeatureModel({ name: '2fast' })).toBe('featuremodel "2fast"\nfeature "2fast"\n')
  })

  it('is not a UVL file: the UVL is made from it when it is needed', () => {
    for (const kind of ['plain', 'project', 'modular'] as const) {
      expect(paths({ name: 'L', kind }).some((p) => p.endsWith('.uvl') || p.endsWith('model.xml'))).toBe(false)
    }
  })
})

describe('buildLineScaffold', () => {
  it('WRITES NOTHING to disk', () => {
    const write = vi.spyOn(fs, 'writeFileSync')
    const mkdir = vi.spyOn(fs, 'mkdirSync')
    buildLineScaffold({ name: 'L' })
    expect(write).not.toHaveBeenCalled()
    expect(mkdir).not.toHaveBeenCalled()
  })

  it('writes config.json with the LineService delimiters and 2-space indentation', () => {
    const config = file({ name: 'L' }, 'src/platform/config.json')
    expect(config).toBe(JSON.stringify(DEFAULT_PLATFORM_CONFIG, null, 2))
    const parsed = JSON.parse(config ?? '{}') as typeof DEFAULT_PLATFORM_CONFIG
    expect(parsed.ignore).toContain('bower_components')
    expect(parsed.delimiters).toHaveLength(4)
    expect(parsed.delimiters[0]?.start).toBe('<!--%')
    expect(parsed.delimiters[3]?.start).toBe('###<')
  })

  it('seeds the code .gitignore verbatim', () => {
    expect(file({ name: 'L' }, 'src/platform/code/.gitignore')).toBe(DEFAULT_CODE_GITIGNORE)
  })

  it('delegates extra.js and transformation.js to the factories', () => {
    expect(file({ name: 'L' }, 'src/platform/extra.js')).toBe(buildExtraJs())
    expect(file({ name: 'L' }, 'src/platform/transformation.js')).toBe(buildTransformationJs())
  })

  it('marks every file as text and uses relative POSIX paths', () => {
    for (const kind of ['plain', 'project', 'modular'] as const) {
      for (const f of buildLineScaffold({ name: 'L', kind })) {
        expect(f.encoding).toBe('text')
        expect(path.isAbsolute(f.path), f.path).toBe(false)
        expect(f.path, f.path).not.toContain('\\')
      }
    }
  })

  it('rejects an invalid name', () => {
    expect(() => buildLineScaffold({ name: '' })).toThrow(InvalidArgumentError)
    expect(() => buildLineScaffold({ name: 'bad name' })).toThrow(InvalidArgumentError)
    expect(() => buildLineScaffold({ name: 'a/b' })).toThrow(InvalidArgumentError)
  })

  it('gives the products a GitHub Actions workflow instead of a GitLab pipeline', () => {
    const github = paths({ name: 'Gis', ci: 'github' })
    expect(github).toContain('src/platform/code/.github/workflows/ci.yml')
    expect(github).not.toContain('src/platform/code/.gitlab-ci.yml')
    expect(paths({ name: 'Gis' })).toContain('src/platform/code/.gitlab-ci.yml')
  })
})

describe('writeLineScaffold', () => {
  it('creates the whole tree on disk, and what it returns is what the pure half described', () => {
    const dir = path.join(makeTmpDir(), 'line')
    const { files, dir: root } = writeLineScaffold({ dir, name: 'L', kind: 'project', metamodels: { 'gitlab:linea/metamodels/datamodel': '^2.0.0' } })
    for (const f of files) expect(fs.readFileSync(path.join(root, ...f.path.split('/')), 'utf8'), f.path).toBe(f.content)
    expect(files).toEqual(buildLineScaffold({ name: 'L', kind: 'project', metamodels: { 'gitlab:linea/metamodels/datamodel': '^2.0.0' } }))
    expect(root).toBe(path.resolve(dir))
  })

  it('rejects an empty dir, and validates the name before creating anything', () => {
    expect(() => writeLineScaffold({ dir: '', name: 'L' })).toThrow(InvalidArgumentError)
    const dir = path.join(makeTmpDir(), 'never')
    expect(() => writeLineScaffold({ dir, name: 'bad name' })).toThrow(InvalidArgumentError)
    expect(fs.existsSync(dir)).toBe(false)
  })
})
