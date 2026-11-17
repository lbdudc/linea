import { describe, expect, it } from 'vitest'
import { checkProduct, checkSpl, deriveModularProduct, listOfferedModels, ModuleCheckError, planPlatform, type Diagnostic } from '../../../src/index.js'
import { createEngine, filesOf, loadFixture, PRODUCT_MODELS, resolveFixtureData, type Fixture } from '../helpers.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CORE = 'file:modules/core'
const UM = 'file:modules/user-management'
const BASIC = 'file:metamodels/basic'
const DATAMODEL = 'file:metamodels/datamodel'

const errorsOf = (diagnostics: readonly Diagnostic[]): Diagnostic[] => diagnostics.filter((d) => d.severity === 'error')

const check = async (change: (fixture: Fixture) => void) => {
  const fixture = loadFixture()
  change(fixture)
  const { resolved, spl } = await resolveFixtureData(fixture)
  return checkSpl({ resolved, spl, createEngine })
}

const editJson = (files: Record<string, string | Uint8Array>, file: string, edit: (value: Record<string, unknown>) => void): void => {
  const value = JSON.parse(files[file] as string) as Record<string, unknown>
  edit(value)
  files[file] = JSON.stringify(value)
}

describe('checkSpl', () => {
  it('has nothing to say about the fixture', async () => {
    const report = await check(() => undefined)
    expect(report.diagnostics).toEqual([])
    expect(report.ok).toBe(true)
    expect([...report.metamodels].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      expect.objectContaining({ name: 'basic', extension: 'basic', package: BASIC, level: 0 }),
      expect.objectContaining({ name: 'datamodel', package: DATAMODEL, requires: [], level: 0 }),
      // the feature model of the SPL is a model of level 1, which its products' models are made from
      expect.objectContaining({ name: 'featuremodel', extension: 'featuremodel', level: 1 }),
      expect.objectContaining({ name: 'featureselection', level: 0, requires: ['featuremodel'] })
    ])
    expect(report.configuration?.models.map((m) => [m.metamodel, m.level, m.file])).toEqual([['featuremodel', 1, 'models/featuremodel.featuremodel']])
  })

  it('reports a metamodel without the grammar of its name', async () => {
    const report = await check((f) => {
      const files = filesOf(f, BASIC)
      files['grammars/other.langium'] = files['grammars/basic.langium'] as string
      delete files['grammars/basic.langium']
    })
    expect(report.ok).toBe(false)
    expect(errorsOf(report.diagnostics)).toContainEqual(expect.objectContaining({ package: BASIC, message: expect.stringMatching(/has no grammars\/basic\.langium/) as string }))
  })

  it('reports a grammar two packages provide', async () => {
    const report = await check((f) => {
      filesOf(f, DATAMODEL)['grammars/common.langium'] = filesOf(f, 'file:metamodels/common')['grammars/common.langium'] as string
    })
    expect(errorsOf(report.diagnostics)).toContainEqual(expect.objectContaining({ package: DATAMODEL, file: 'grammars/common.langium', message: expect.stringMatching(/also provided by/) as string }))
  })

  it('reports the errors of a grammar, with its position', async () => {
    const report = await check((f) => {
      const files = filesOf(f, DATAMODEL)
      files['grammars/datamodel.langium'] = String(files['grammars/datamodel.langium']) + '\nBroken: ;;;\n'
    })
    const problem = errorsOf(report.diagnostics).find((d) => d.file === 'grammars/datamodel.langium')
    expect(problem?.package).toBe(DATAMODEL)
    expect(problem?.message).toMatch(/^\d+:\d+ /)
  })

  it('reports an import of a grammar the package does not declare it needs', async () => {
    const report = await check((f) => {
      editJson(filesOf(f, BASIC), 'metamodel.json', (m) => { m.requires = {} })
    })
    expect(errorsOf(report.diagnostics)).toContainEqual(expect.objectContaining({
      package: BASIC,
      file: 'grammars/basic.langium',
      message: expect.stringMatching(/imports "common".*file:metamodels\/common is not in its "requires"/) as string
    }))
  })

  it('reports an offer of a metamodel the module does not require', async () => {
    const report = await check((f) => {
      editJson(filesOf(f, CORE), '.linea/module.json', (m) => { m.offers = { datamodel: 'models/x.instance' } })
    })
    expect(errorsOf(report.diagnostics)).toContainEqual(expect.objectContaining({
      package: CORE,
      file: '.linea/module.json',
      message: expect.stringMatching(/offers a model of "datamodel"/) as string
    }))
  })

  it('reports an offered model that does not exist', async () => {
    const report = await check((f) => {
      editJson(filesOf(f, UM), '.linea/module.json', (m) => { m.offers = { datamodel: 'models/missing.instance' } })
    })
    expect(errorsOf(report.diagnostics)).toContainEqual(expect.objectContaining({ package: UM, file: 'models/missing.instance' }))
  })

  it('reports an offered model that is not valid', async () => {
    const report = await check((f) => {
      filesOf(f, UM)['models/datamodel.instance'] = 'datamodel um\n\nentity A {\n  relation r -> Nowhere\n}\n'
    })
    const problem = errorsOf(report.diagnostics).find((d) => d.file === 'models/datamodel.instance')
    expect(problem?.package).toBe(UM)
    expect(problem?.message).toMatch(/Nowhere/)
  })

  it('reports a name that two modules offer', async () => {
    const report = await check((f) => {
      editJson(filesOf(f, CORE), '.linea/module.json', (m) => {
        m.requires = { metamodels: { [BASIC]: '^1.0.0', [DATAMODEL]: '^2.0.0' } }
        m.offers = { datamodel: 'models/datamodel.instance' }
      })
      filesOf(f, CORE)['models/datamodel.instance'] = 'datamodel core\n\nentity UM_User {\n  property x: String pk\n}\n'
    })
    expect(errorsOf(report.diagnostics).map((d) => d.message).join('\n')).toMatch(/'UM_User' \(Entity\) is already declared by/)
  })

  it('reports two modules with the same name', async () => {
    const report = await check((f) => {
      editJson(filesOf(f, CORE), '.linea/module.json', (m) => { m.name = 'user-management' })
    })
    expect(errorsOf(report.diagnostics)).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/module name "user-management" is also used/) as string }))
  })

  it('reports a feature two modules declare', async () => {
    const report = await check((f) => {
      filesOf(f, CORE)['.linea/model.uvl'] = 'features\n\tCore\n\t\toptional\n\t\t\tProfile\n'
    })
    expect(errorsOf(report.diagnostics)).toContainEqual(expect.objectContaining({ file: '.linea/model.uvl', message: expect.stringMatching(/feature "Profile" is also declared by/) as string }))
  })

  it('reports a merged feature model that does not parse', async () => {
    const report = await check((f) => {
      filesOf(f, CORE)['.linea/model.uvl'] = 'features\n\tCore\n\t\tnonsense words here\n\t\t\t@@@\n'
    })
    expect(errorsOf(report.diagnostics)).toContainEqual(expect.objectContaining({ package: 'spl', message: expect.stringMatching(/merged feature model is not valid/) as string }))
  })

  it('reports an SPL feature model that is not valid, with its position and file', async () => {
    const report = await check((f) => { f.spl['models/featuremodel.featuremodel'] = 'featuremodel GisApps\n' })
    expect(report.ok).toBe(false)
    expect(errorsOf(report.diagnostics)).toContainEqual(expect.objectContaining({ package: 'spl', file: 'models/featuremodel.featuremodel', message: expect.stringMatching(/^\d+:\d+ / ) as string }))
  })

  it('makes the feature model of an SPL that has none: the root, named after the SPL', async () => {
    const report = await check((f) => { delete f.spl['models/featuremodel.featuremodel'] })
    expect(report.ok).toBe(true)
    expect(report.configuration?.models[0]?.text).toContain('featuremodel GisApps')
  })

  it('asks for the feature metamodel: an SPL without it cannot offer a feature model', async () => {
    const report = await check((f) => {
      // a plain SPL with no module that brings the feature metamodel either
      f.spl['spl.json'] = JSON.stringify({ name: 'gis-apps', kind: 'plain', metamodels: {}, modules: {} })
    })
    expect(report.ok).toBe(false)
    expect(errorsOf(report.diagnostics)).toContainEqual(expect.objectContaining({ package: 'spl', message: expect.stringMatching(/no feature metamodel/) as string }))
  })

  it('can check a package on its own, with no SPL around it', async () => {
    const fixture = loadFixture()
    const { resolved } = await resolveFixtureData(fixture)
    const report = await checkSpl({ resolved, createEngine, configuration: false })
    expect(report.ok).toBe(true)
    expect(report.configuration).toBeUndefined()
  })

  it('reports files two modules provide with different content, but not identical ones', async () => {
    const clash = await check((f) => {
      filesOf(f, CORE)['code/server/shared.js'] = 'a'
      filesOf(f, UM)['code/server/shared.js'] = 'b'
    })
    expect(errorsOf(clash.diagnostics)).toContainEqual(expect.objectContaining({
      package: UM,
      file: 'code/server/shared.js',
      message: expect.stringMatching(/server\/shared\.js is also provided by file:modules\/core/) as string
    }))
    const same = await check((f) => {
      filesOf(f, CORE)['code/server/shared.js'] = 'same'
      filesOf(f, UM)['code/server/shared.js'] = 'same'
    })
    expect(same.diagnostics).toEqual([])
  })

  it('warns about a type that clashes between metamodels', async () => {
    const report = await check((f) => {
      f.packages['file:metamodels/other'] = {
        '1.0.0': {
          'metamodel.json': JSON.stringify({ name: 'other', version: '1.0.0', requires: { 'file:metamodels/common': '^1.0.0' } }),
          'grammars/other.langium': "grammar Other\nimport './common'\n\n// Other\nentry Top: 'other' name=ID? (items+=Entity)*;\n\nEntity: 'e' name=ID;\n"
        }
      }
      editJson(filesOf(f, CORE), '.linea/module.json', (m) => {
        m.requires = { metamodels: { [BASIC]: '^1.0.0', 'file:metamodels/other': '^1.0.0' } }
      })
    })
    expect(report.diagnostics.filter((d) => d.severity === 'warning')).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/clashes with the one of/) as string }))
  })
})

describe('planPlatform / composePlatform', () => {
  const plan = async (change: (fixture: Fixture) => void, withSpl = true) => {
    const fixture = loadFixture()
    change(fixture)
    const { resolved, spl } = await resolveFixtureData(fixture)
    return planPlatform({ resolved, ...(withSpl ? { spl } : {}) })
  }

  it('makes up a root feature from the SPL name when it has no model', async () => {
    const result = await plan(() => undefined, false)
    expect(result.featureModel.startsWith('features\n\tGisApps\n\t\tmandatory\n')).toBe(true)
    expect(result.diagnostics).toEqual([])
  })

  it('lets the SPL override the code of a module, silently', async () => {
    const result = await plan((f) => { f.spl['src/platform/code/server/core.js'] = 'mine' })
    expect(result.diagnostics).toEqual([])
    const file = result.files.get('src/platform/code/server/core.js')
    expect(new TextDecoder().decode(file?.content)).toBe('mine')
    expect(file?.from).toBe('spl')
  })

  it('chains the helpers and transformations: core, modules in order, then the SPL', async () => {
    const result = await plan((f) => {
      f.spl['src/platform/extra.js'] = 'function mine() {}'
      f.spl['src/platform/transformation.js'] = 'registerMetamodelProcessor(function () {});'
    })
    expect(result.extraJs.indexOf('pluralize')).toBeLessThan(result.extraJs.indexOf('coreName'))
    expect(result.extraJs.indexOf('coreName')).toBeLessThan(result.extraJs.indexOf('function mine'))
    expect(result.transformation.indexOf('function registerMetamodelProcessor')).toBeLessThan(result.transformation.indexOf('ret.data.models'))
    expect(result.transformation.endsWith('registerMetamodelProcessor(function () {});')).toBe(true)
  })

  it('merges the delimiters and ignored folders of the modules and the SPL', async () => {
    const result = await plan((f) => {
      filesOf(f, CORE)['.linea/config/config.json'] = JSON.stringify({ ignore: ['tmp', 'build'], delimiters: [{ extension: ['txt'], start: '[[', end: ']]' }, { extension: ['json'], start: '###<', end: '>###' }] })
      f.spl['src/platform/config.json'] = JSON.stringify({ delimiters: [{ extension: ['txt'], start: '{{', end: '}}' }], ignore: [3] })
    })
    expect(result.diagnostics).toEqual([])
    expect(result.config.ignore).toContain('tmp')
    expect(result.config.ignore.filter((i) => i === 'build')).toHaveLength(1)
    expect(result.config.delimiters.find((d) => d.extension.includes('txt'))).toEqual({ extension: ['txt'], start: '{{', end: '}}' })
  })

  it('reports delimiters of a module that clash with the core ones, and a config that is not valid', async () => {
    const clash = await plan((f) => {
      filesOf(f, CORE)['.linea/config/config.json'] = JSON.stringify({ delimiters: [{ extension: ['json'], start: '<<', end: '>>' }] })
    })
    expect(errorsOf(clash.diagnostics)).toContainEqual(expect.objectContaining({ package: CORE, file: '.linea/config/config.json', message: expect.stringMatching(/clash with those of linea/) as string }))

    const second = await plan((f) => {
      filesOf(f, CORE)['.linea/config/config.json'] = JSON.stringify({ delimiters: [{ extension: ['txt'], start: '[[', end: ']]' }] })
      filesOf(f, UM)['.linea/config/config.json'] = JSON.stringify({ delimiters: [{ extension: ['txt'], start: '((', end: '))' }] })
    })
    expect(errorsOf(second.diagnostics)).toContainEqual(expect.objectContaining({ package: UM, message: expect.stringMatching(/clash with those of file:modules\/core/) as string }))

    const broken = await plan((f) => {
      filesOf(f, CORE)['.linea/config/config.json'] = '{'
      filesOf(f, UM)['.linea/config/config.json'] = '[]'
    })
    expect(errorsOf(broken.diagnostics)).toHaveLength(2)
  })

  it('reports files two modules provide with different content, and derives nothing from them', async () => {
    const fixture = loadFixture()
    filesOf(fixture, CORE)['code/server/x.js'] = 'a'
    filesOf(fixture, UM)['code/server/x.js'] = 'b'
    const { resolved, spl } = await resolveFixtureData(fixture)
    const planned = await planPlatform({ resolved, spl })
    expect(errorsOf(planned.diagnostics)).toContainEqual(expect.objectContaining({ package: UM, file: 'code/server/x.js' }))
    const report = await checkProduct({ resolved, spl, models: PRODUCT_MODELS, createEngine })
    expect(report.ok).toBe(false)
    const dir = path.join(os.tmpdir(), `linea-derive-${String(process.pid)}-${String(Date.now())}`)
    const run = deriveModularProduct({ resolved, spl, spec: {}, models: PRODUCT_MODELS, createEngine, outputDir: dir })
    await expect(run).rejects.toBeInstanceOf(ModuleCheckError)
    await expect(run).rejects.toMatchObject({ code: 'MODULE_CHECK_FAILED', diagnostics: expect.any(Array) as unknown })
    expect(fs.existsSync(dir)).toBe(false)
  })
})

describe('listOfferedModels', () => {
  it('lists what the modules offer, skipping what does not exist', async () => {
    const fixture = loadFixture()
    editJson(filesOf(fixture, CORE), '.linea/module.json', (m) => { m.offers = { datamodel: 'models/missing.instance' } })
    const { resolved } = await resolveFixtureData(fixture)
    expect((await listOfferedModels({ resolved })).map((offered) => offered.package)).toEqual([UM])
    const { resolved: whole } = await resolveFixtureData(loadFixture())
    expect(await listOfferedModels({ resolved: whole })).toEqual([
      expect.objectContaining({ origin: 'user-management', metamodel: 'datamodel', package: UM, file: 'models/datamodel.instance', text: expect.stringContaining('UM_User') as string })
    ])
  })
})

describe('scripts of a metamodel', () => {
  it('reports a JSON mapping that is not valid when the package is checked, not only when a product is built', async () => {
    const report = await check((f) => {
      filesOf(f, DATAMODEL)['specs/datamodel.js'] = 'const spec = function (model) { return {}; };\n'
    })
    expect(report.ok).toBe(false)
    expect(errorsOf(report.diagnostics)).toContainEqual(expect.objectContaining({
      package: DATAMODEL,
      file: 'grammars/datamodel.langium',
      message: expect.stringMatching(/datamodel\.spec\.js: a JSON mapping must/) as string
    }))
  })
})
