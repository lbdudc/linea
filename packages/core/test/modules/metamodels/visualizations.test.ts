import { describe, expect, it } from 'vitest'
import { checkSpl, readMetamodelBundle, readMetamodelFiles } from '../../../src/index.js'
import { createEngine, filesOf, loadFixture, resolveFixtureData } from '../helpers.js'

const VIEWS = "return [{ id: 'x', label: 'X', create: () => ({ mount() {}, update() {}, dispose() {} }) }];"

describe('the visualizations a metamodel brings', () => {
  it('are read with the metamodel, by grammar, and reach the bundle that is sent to a browser', async () => {
    const fixture = loadFixture()
    filesOf(fixture, 'file:metamodels/basic')['visualizations/basic.js'] = VIEWS
    const { resolved } = await resolveFixtureData(fixture)

    const pkg = resolved.metamodels.find((m) => m.location === 'file:metamodels/basic')!
    expect((await readMetamodelFiles({ pkg })).find((f) => f.grammar === 'basic')?.visualizations).toBe(VIEWS)

    const bundle = await readMetamodelBundle({ resolved })
    expect(bundle.visualizations).toEqual({ basic: VIEWS })
    // none of the other metamodels brings any
    expect(Object.keys(bundle.grammars).length).toBeGreaterThan(1)
  })

  it('are page code: checking the SPL does not run them, even when they would not load', async () => {
    const fixture = loadFixture()
    filesOf(fixture, 'file:metamodels/basic')['visualizations/basic.js'] = 'this is not javascript {'
    const { resolved } = await resolveFixtureData(fixture)
    const report = await checkSpl({ resolved, createEngine })
    expect(report.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect((await readMetamodelBundle({ resolved })).visualizations.basic).toBe('this is not javascript {')
  })

  it('a metamodel without them has none in the bundle', async () => {
    const { resolved } = await resolveFixtureData(loadFixture())
    expect((await readMetamodelBundle({ resolved })).visualizations).toEqual({})
  })
})
