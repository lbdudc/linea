import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkProduct,
  checkSpl,
  deriveModularProduct,
  ModuleCheckError,
  planPlatform,
  writePlatform
} from '../../src/index.js'
import { createEngine, PRODUCT_MODELS, resolveFixture, splFiles } from './helpers.js'

const created: string[] = []
const tmp = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-modules-'))
  created.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('a modular SPL, end to end', () => {
  it('resolves the transitive closure, dependencies first', async () => {
    const resolved = await resolveFixture()
    expect(resolved.modules.map((m) => m.location)).toEqual(['file:modules/core', 'file:modules/user-management'])
    const metamodels = resolved.metamodels.map((m) => m.location)
    expect(metamodels[0]).toBe('file:metamodels/common')
    expect([...metamodels].sort()).toEqual(['file:metamodels/basic', 'file:metamodels/common', 'file:metamodels/datamodel', 'file:metamodels/featuremodel'])
    expect(resolved.lock.packages['file:metamodels/datamodel']).toEqual({ kind: 'metamodel', version: '2.1.0' })
  })

  it('checks the SPL: metamodels compose, offered models are valid, the feature model merges', async () => {
    const resolved = await resolveFixture()
    const report = await checkSpl({ resolved, spl: splFiles(), createEngine })
    expect(report.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.metamodels.map((m) => m.name).sort()).toEqual(['basic', 'datamodel', 'featuremodel', 'featureselection'])
    expect(report.featureModel).toBe(
      'features\n\tGisApps\n\t\tmandatory\n\t\t\tCore\n\t\t\t\toptional\n\t\t\t\t\tAudit\n\t\t\tUserManagement\n\t\t\t\toptional\n\t\t\t\t\tProfile\n\t\toptional\n\t\t\tReports\n'
    )
  })

  it('accepts a product with a model of every metamodel, and merges them', async () => {
    const resolved = await resolveFixture()
    const report = await checkProduct({ resolved, spl: splFiles(), models: PRODUCT_MODELS, createEngine })
    expect(report.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(report.ok).toBe(true)
    expect(JSON.stringify(report.models)).toContain('Order')
  })

  it('composes a platform and derives a product from it', async () => {
    const resolved = await resolveFixture()
    const output = tmp()
    const { diagnostics } = await deriveModularProduct({
      resolved,
      spl: splFiles(),
      spec: { basicData: { name: 'Shop', version: '1.0.0' } },
      models: PRODUCT_MODELS,
      createEngine,
      outputDir: output
    })
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(fs.readFileSync(path.join(output, 'server', 'core.js'), 'utf8')).toContain('core:shop')
    const users = fs.readFileSync(path.join(output, 'server', 'users.js'), 'utf8')
    expect(users).toContain('export const profile = true;')
    expect(users).toContain('Order')
    expect(users).toContain('export const byMetamodel = {')
    expect(users).toMatch(/byMetamodel = \{.*"basic".*"datamodel"/)
    expect(fs.existsSync(path.join(output, 'README.js'))).toBe(true)
  })

  it('refuses to derive a product whose models do not fit', async () => {
    const resolved = await resolveFixture()
    await expect(deriveModularProduct({
      resolved,
      spl: splFiles(),
      spec: { basicData: { name: 'Shop', version: '1.0.0' }, features: ['GisApps'] },
      models: { basic: 'basic shop\n' },
      createEngine,
      outputDir: tmp()
    })).rejects.toBeInstanceOf(ModuleCheckError)
  })

  it('writes the composed platform as an ordinary line', async () => {
    const resolved = await resolveFixture()
    const dir = tmp()
    const plan = await planPlatform({ resolved, spl: splFiles(), ownFeatureModel: 'features\n\tGisApps\n' })
    writePlatform({ plan, lineDir: dir })
    expect(fs.existsSync(path.join(dir, 'src/platform/model.uvl'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'src/platform/code/server/users.js'))).toBe(true)
    expect(plan.extraJs).toContain('coreName')
    expect(plan.transformation).toContain('registerMetamodelProcessor')
  })
})
