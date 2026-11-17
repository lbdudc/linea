import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import es from 'src/i18n/es'
import { modelTabs, forgetLineModules, rememberLineModules } from 'components/modules/modulesTab'

const { getLineModules } = vi.hoisted(() => ({ getLineModules: vi.fn() }))
vi.mock('src/services/packageService', () => ({ default: { getLineModules } }))

const keys = (tabs) => tabs.map((t) => t.key)

describe('the tabs of a line for its packages and its models', () => {
  beforeEach(() => { forgetLineModules(); getLineModules.mockReset() })

  it('a project has its metamodels and its feature model, and its modules only when it has some', async () => {
    getLineModules.mockResolvedValue({ kind: 'project', spl: { modules: {} } })
    const project = { _id: 'p1', kind: 'project' }
    expect(keys(modelTabs('p1', project))).toEqual(['metamodels', 'model'])
    await flushPromises()
    expect(getLineModules).toHaveBeenCalledWith({ id: 'p1' })
    expect(keys(modelTabs('p1', project))).toEqual(['metamodels', 'model'])
    expect(modelTabs('p1', project).map((t) => t.labelKey)).toEqual(['modules.tab_metamodels', 'modules.tab_feature_model'])
    expect(modelTabs('p1', project)[0].path).toBe('/lines/p1/metamodels')
    expect([es.modules.tab_metamodels, es.modules.tab_feature_model]).toEqual(['Metamodelos', 'Modelo de características'])

    rememberLineModules('p1', { spl: { modules: { 'gitlab:linea/modules/users': '^1.0.0' } } })
    expect(keys(modelTabs('p1', project))).toEqual(['metamodels', 'model', 'modules'])
    expect(getLineModules).toHaveBeenCalledTimes(1)
  })

  it('a project with modules shows them once its manifest is read', async () => {
    getLineModules.mockResolvedValue({ kind: 'project', spl: { modules: { 'gitlab:linea/modules/users': '^1.0.0' } } })
    const project = { _id: 'p2', kind: 'project' }
    modelTabs('p2', project)
    await flushPromises()
    expect(keys(modelTabs('p2', project))).toEqual(['metamodels', 'model', 'modules'])
  })

  it('a modular line keeps its modules and its models, and a plain line only its models', () => {
    expect(keys(modelTabs('m1', { kind: 'modular', modular: true }))).toEqual(['modules', 'model'])
    expect(modelTabs('m1', { kind: 'modular', modular: true })[1].labelKey).toBe('modules.tab_model')
    expect(keys(modelTabs('s1', { kind: 'plain' }))).toEqual(['model'])
    expect(getLineModules).not.toHaveBeenCalled()
  })
})
