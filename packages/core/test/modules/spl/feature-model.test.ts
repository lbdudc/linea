import { describe, expect, it } from 'vitest'
import { checkSpl, planPlatform } from '../../../src/index.js'
import { createEngine, filesOf, loadFixture, resolveFixtureData, selectionVerdict, type Fixture } from '../helpers.js'

const CORE = 'file:modules/core'
const UM = 'file:modules/user-management'

// the feature model of the SPL itself: its root, and what it declares of its own
const OWN = 'features\n\tGisApps\n\t\toptional\n\t\t\tReports\n'

const compose = async (change: (fixture: Fixture) => void, ownFeatureModel = OWN) => {
  const fixture = loadFixture()
  change(fixture)
  const { resolved, spl } = await resolveFixtureData(fixture)
  const plan = await planPlatform({ resolved, spl, ownFeatureModel })
  return { plan }
}

const uvl = (...lines: string[]): string => lines.join('\n') + '\n'

describe('the feature model of an SPL made of modules', () => {
  it('hangs the tree of each module under the root of the SPL, whatever indentation it was written with', async () => {
    const { plan } = await compose((f) => {
      filesOf(f, CORE)['.linea/model.uvl'] = uvl('features', '  Core', '    optional', '      Audit', '        or', '          Syslog', '          File')
      filesOf(f, UM)['.linea/model.uvl'] = uvl('features', '\tUserManagement', '\t\toptional', '\t\t\tProfile')
    })
    expect(plan.diagnostics).toEqual([])
    expect(plan.featureModel).toBe(uvl(
      'features', '\tGisApps', '\t\tmandatory',
      '\t\t\tCore', '\t\t\t\toptional', '\t\t\t\t\tAudit', '\t\t\t\t\t\tor', '\t\t\t\t\t\t\tSyslog', '\t\t\t\t\t\t\tFile',
      '\t\t\tUserManagement', '\t\t\t\toptional', '\t\t\t\t\tProfile',
      '\t\toptional', '\t\t\tReports'
    ))
  })

  it('joins the mandatory group the SPL already has, and keeps its own features', async () => {
    const { plan } = await compose(() => undefined, uvl('features', '\tGisApps', '\t\tmandatory', '\t\t\tBase', '\t\toptional', '\t\t\tReports'))
    expect(plan.diagnostics).toEqual([])
    const lines = plan.featureModel.split('\n')
    const group = lines.indexOf('\t\tmandatory')
    expect(lines.slice(group, group + 4)).toEqual(['\t\tmandatory', '\t\t\tBase', '\t\t\tCore', '\t\t\t\toptional'])
    expect(lines).toContain('\t\t\tReports')
  })

  it('merges the constraints of the modules, including the ones that tie two modules together', async () => {
    const { plan } = await compose((f) => {
      filesOf(f, CORE)['.linea/model.uvl'] = uvl('features', '\tCore', '\t\toptional', '\t\t\tAudit')
      filesOf(f, UM)['.linea/model.uvl'] = uvl('features', '\tUserManagement', '\t\toptional', '\t\t\tProfile', '', 'constraints', '\tProfile => Audit')
    }, uvl('features', '\tGisApps', '\t\toptional', '\t\t\tReports', '', 'constraints', '\tReports => Profile'))
    expect(plan.diagnostics).toEqual([])
    expect(plan.featureModel).toContain(uvl('constraints', '\tReports => Profile', '\tProfile => Audit'))
    // choosing Reports drags in Profile, and through it Audit, across the three packages
    const verdict = await selectionVerdict({ featureModel: plan.featureModel, features: ['Reports'] })
    expect(verdict.valid).toBe(true)
    expect(verdict.completed).toEqual(expect.arrayContaining(['GisApps', 'Core', 'UserManagement', 'Reports', 'Profile', 'Audit']))
  })

  it('makes the module roots mandatory: they are in every product', async () => {
    const { plan } = await compose(() => undefined)
    const verdict = await selectionVerdict({ featureModel: plan.featureModel, features: [] })
    expect(verdict.valid).toBe(true)
    expect(verdict.completed).toEqual(expect.arrayContaining(['GisApps', 'Core', 'UserManagement']))
    expect(verdict.completed).not.toContain('Profile')
  })

  it('keeps the groups and the quoted names of the modules', async () => {
    const { plan } = await compose((f) => {
      filesOf(f, CORE)['.linea/model.uvl'] = uvl('features', '\tCore', '\t\talternative', '\t\t\t"Fast mode"', '\t\t\tSlow')
    })
    expect(plan.diagnostics).toEqual([])
    expect(plan.featureModel).toContain('\t\t\t\t\t"Fast mode"')
    expect((await selectionVerdict({ featureModel: plan.featureModel, features: ['Fast mode', 'Slow'] })).valid).toBe(false)
  })

  it('does not lose anything when a module has no model at all', async () => {
    const { plan } = await compose((f) => { delete filesOf(f, CORE)['.linea/model.uvl'] })
    expect(plan.diagnostics).toEqual([])
    expect(plan.featureModel).not.toContain('Core')
    expect(plan.featureModel).toContain('UserManagement')
  })

  it('reports a constraint that names a feature nobody declares', async () => {
    const fixture = loadFixture()
    filesOf(fixture, UM)['.linea/model.uvl'] = uvl('features', '\tUserManagement', '', 'constraints', '\tUserManagement => Ghost')
    const { resolved, spl } = await resolveFixtureData(fixture)
    const report = await checkSpl({ resolved, spl, createEngine })
    expect(report.ok).toBe(false)
    expect(report.diagnostics.map((d) => d.message).join('\n')).toMatch(/Ghost|merged feature model is not valid/)
  })
})
