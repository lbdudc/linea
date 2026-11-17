import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildEngineSpec, checkProduct, deriveModularProduct, deriveModularProductToZip, ModuleCheckError, seedProductModels } from '../../../src/index.js'
import { createEngine, loadFixture, PRODUCT_MODELS, resolveFixtureData } from '../helpers.js'

const created: string[] = []
afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const setup = async () => resolveFixtureData(loadFixture())

describe('checkProduct', () => {
  it('asks for a model of every metamodel, naming the file', async () => {
    const { resolved, spl } = await setup()
    const report = await checkProduct({ resolved, spl, models: { basic: PRODUCT_MODELS.basic }, createEngine })
    expect(report.ok).toBe(false)
    expect(report.models).toBeUndefined()
    expect(report.diagnostics).toContainEqual({
      severity: 'error', package: 'product', file: '.linea/models/datamodel.datamodel', message: 'There is no model of "datamodel".'
    })
  })

  it('refuses a model of something that is not a metamodel of the SPL', async () => {
    const { resolved, spl } = await setup()
    const report = await checkProduct({ resolved, spl, models: { ...PRODUCT_MODELS, zzz: 'x' }, createEngine })
    expect(report.ok).toBe(false)
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ file: '.linea/models/zzz', message: '"zzz" is not a metamodel of the products of this SPL.' }))
  })

  it('reports what is wrong inside a model, with its position and file', async () => {
    const { resolved, spl } = await setup()
    const report = await checkProduct({
      resolved,
      spl,
      models: { ...PRODUCT_MODELS, datamodel: 'datamodel shop\n\nentity Order {\n  property code: String pk\n  relation account -> NOPE\n}\n' },
      createEngine
    })
    expect(report.ok).toBe(false)
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ package: 'product', file: '.linea/models/datamodel.datamodel', message: expect.stringMatching(/^5:\d+ .*NOPE/) as string }))
  })

  it('accepts the references a product makes to what a module offers', async () => {
    const { resolved, spl } = await setup()
    const report = await checkProduct({ resolved, spl, models: PRODUCT_MODELS, createEngine })
    expect(report.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(report.ok).toBe(true)
    // a product has a model of each metamodel whose models are final; the feature model of its SPL is offered to its selection, not part of it
    expect(report.metamodels.map((m) => m.name).sort()).toEqual(['basic', 'datamodel', 'featureselection'])
    expect(Object.keys(report.modelsByMetamodel ?? {}).sort()).toEqual(['basic', 'datamodel', 'featureselection'])
    expect(JSON.stringify(report.modelsByMetamodel?.datamodel)).toContain('Order')
  })

  it('rejects a product whose model redeclares what a module offers', async () => {
    const { resolved, spl } = await setup()
    const report = await checkProduct({
      resolved,
      spl,
      models: { ...PRODUCT_MODELS, datamodel: 'datamodel shop\n\nentity UM_User {\n  property x: String pk\n}\n' },
      createEngine
    })
    expect(report.ok).toBe(false)
    expect(report.diagnostics.map((d) => d.message).join('\n')).toMatch(/'UM_User' \(Entity\) is already declared by 'user-management' \(read-only\)/)
  })

  it('checks the feature selection against the merged feature model, with the feature metamodel', async () => {
    const { resolved, spl } = await setup()
    const bad = await checkProduct({ resolved, spl, models: { ...PRODUCT_MODELS, featureselection: 'selection of GisApps {\n  select Nope\n}\n' }, createEngine })
    expect(bad.ok).toBe(false)
    expect(bad.diagnostics).toContainEqual(expect.objectContaining({ package: 'product', file: '.linea/models/featureselection.featureselection', message: expect.stringMatching(/Nope/) as string }))
    const good = await checkProduct({ resolved, spl, models: { ...PRODUCT_MODELS, featureselection: 'selection of GisApps {\n  select Profile\n  select Audit\n}\n' }, createEngine })
    expect(good.ok).toBe(true)
  })

  it('has the features of the product from its selection: what it chose, and what the feature model implies', async () => {
    const { resolved, spl } = await setup()
    const report = await checkProduct({ resolved, spl, models: PRODUCT_MODELS, createEngine })
    expect((report.models as { features: string[] }).features).toEqual(['GisApps', 'Core', 'UserManagement', 'Profile'])
  })

  it('says what is wrong with the feature model of the SPL, and does not take the product for good', async () => {
    const fixture = loadFixture()
    fixture.spl['models/featuremodel.featuremodel'] = 'featuremodel GisApps\nfeature GisApps {\n  optional {\n    feature Reports\n    feature Reports\n  }\n}\n'
    const { resolved, spl } = await resolveFixtureData(fixture)
    const report = await checkProduct({ resolved, spl, models: PRODUCT_MODELS, createEngine })
    expect(report.ok).toBe(false)
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ package: 'spl', file: 'models/featuremodel.featuremodel', message: expect.stringMatching(/duplicate feature 'Reports'/) as string }))
  })
})

describe('deriveModularProduct', () => {
  it('throws ModuleCheckError with every diagnostic when the product does not fit', async () => {
    const { resolved, spl } = await setup()
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-derive-'))
    created.push(output)
    const run = deriveModularProduct({ resolved, spl, spec: {}, models: {}, createEngine, outputDir: output })
    await expect(run).rejects.toBeInstanceOf(ModuleCheckError)
    await expect(run).rejects.toThrow(/There is no model of "basic"/)
    await expect(run).rejects.toMatchObject({ diagnostics: expect.arrayContaining([expect.objectContaining({ package: 'product' })]) as unknown })
  })

  it('reports what cannot be composed, and a merged feature model that does not parse', async () => {
    const fixture = loadFixture()
    fixture.spl['models/featuremodel.featuremodel'] = 'featuremodel GisApps\nfeature GisApps {\n  optional {\n    feature Profile\n  }\n}\n'
    const { resolved, spl } = await resolveFixtureData(fixture)
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-derive-'))
    created.push(output)
    await expect(deriveModularProduct({ resolved, spl, spec: {}, models: PRODUCT_MODELS, createEngine, outputDir: output }))
      .rejects.toThrow(/spl models\/featuremodel: The feature "Profile" is also declared by/)
  })
})

describe('buildEngineSpec with models', () => {
  it('carries the models into the engine spec of a sensor product', () => {
    const spec = {
      basicData: { name: 'p' },
      sensor: { parsed: { features: ['a'], data: { basicData: { name: 'p' } } } },
      models: { x: 1 }
    }
    expect(buildEngineSpec({ spec })).toMatchObject({ features: ['a'], models: { x: 1 } })
    expect(buildEngineSpec({ spec: { ...spec, models: undefined } })).not.toHaveProperty('models')
  })
})

describe('seedProductModels / deriveModularProductToZip', () => {
  it('starts every metamodel with its minimal valid model, which together fit the SPL up to what the product adds', async () => {
    const { resolved } = await setup()
    const { spl: files } = await setup()
    const seeded = await seedProductModels({ resolved, spl: files, createEngine })
    expect(Object.keys(seeded.models).sort()).toEqual(['basic', 'datamodel', 'featureselection'])
    expect(seeded.models.datamodel).toMatch(/^datamodel/)
    // a selection of the SPL's feature model, which is offered to it: the root alone
    expect(seeded.models.featureselection).toMatch(/^selection of GisApps/)
    expect(seeded.metamodels).toHaveLength(3)
    const { spl } = await setup()
    const report = await checkProduct({ resolved, spl, models: seeded.models, createEngine })
    expect(report.ok).toBe(true)
  })

  it('derives a product as a zip', async () => {
    const { resolved, spl } = await setup()
    const zip = await deriveModularProductToZip({
      resolved,
      spl,
      spec: { basicData: { name: 'Shop', version: '1.0.0' } },
      models: PRODUCT_MODELS,
      createEngine
    })
    expect(zip.subarray(0, 2).toString()).toBe('PK')
  })

  it('does not derive a zip for a product that does not fit', async () => {
    const { resolved, spl } = await setup()
    await expect(deriveModularProductToZip({ resolved, spl, spec: {}, models: {}, createEngine })).rejects.toBeInstanceOf(ModuleCheckError)
  })
})
