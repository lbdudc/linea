import { describe, expect, it } from 'vitest'
import { buildTransformationJs } from '../../src/index.js'

type Transformation = ((input: Record<string, unknown>) => { features: string[], data: Record<string, any> }) & {
  register: (fn: (ret: any, input: any) => void) => void
}

const load = (): Transformation => {
  const module = { exports: undefined as unknown }
  const register = new Function('module', `${buildTransformationJs()}\nreturn registerMetamodelProcessor;`)(module)
  return Object.assign(module.exports as Transformation, { register })
}

const SPEC = { basicData: { name: 'Shop', version: '1.2.0', languages: ['es'] }, features: ['GUI_M_Top'], statics: [{ id: 'about' }] }

describe('the transformation.js a new line starts with', () => {
  it('builds the data of a simple SPL from its spec, as before', () => {
    const { data, features } = load()(SPEC)
    expect(features).toEqual(['GUI_M_Top'])
    expect(data.basicData).toMatchObject({ name: 'Shop', version: '1.2.0', languages: ['es'], packageInfo: { artifact: 'shop', group: 'com.example' } })
    expect(data.gui.design).toBe('1')
    expect(data.menus).toEqual([{ id: 'top', elements: [{ id: 'Components', type: 'MENU', elements: [], access: { admin: true, logged: true } }] }])
    expect(data.statics).toEqual([{ id: 'about' }])
    expect(data.dataModel).toBeUndefined()
  })

  it('gives the templates of a project the models LINEA merged', () => {
    const models = {
      features: ['GUI_M_Top'],
      data: {
        basicData: { name: 'tienda', packageInfo: { artifact: 'tienda', group: 'es.udc.lbd' }, languages: ['gl'] },
        dataModel: { entities: [{ name: 'Customer', properties: [] }], enums: [] },
        forms: [{ id: 'CustomerForm' }],
        gui: { settings: { header: { type: 'Text', text: 'Tienda' } } }
      }
    }
    const { data } = load()({ ...SPEC, models })
    expect(data.dataModel.entities.map((e: { name: string }) => e.name)).toEqual(['Customer'])
    expect(data.forms).toEqual([{ id: 'CustomerForm' }])
    expect(data.basicData).toEqual({ name: 'tienda', packageInfo: { artifact: 'tienda', group: 'es.udc.lbd' }, languages: ['gl'], version: '1.2.0' })
    expect(data.gui).toMatchObject({ design: '1', settings: { header: { text: 'Tienda' } } })
    expect(data.statics).toEqual([{ id: 'about' }])
    expect(models.data.basicData).not.toHaveProperty('version')
  })

  it('keeps the version the models give, and what the processors of the metamodels add', () => {
    const transformation = load()
    transformation.register((ret, input) => { ret.data.byMetamodel = Object.keys(input.modelsByMetamodel) })
    const { data } = transformation({ ...SPEC, models: { data: { basicData: { name: 'tienda', version: '3.0.0' } } }, modelsByMetamodel: { datamodel: {} } })
    expect(data.basicData.version).toBe('3.0.0')
    expect(data.byMetamodel).toEqual(['datamodel'])
  })

  it('passes a spec that already has its data through', () => {
    const input = { features: [], data: { basicData: { name: 'ready' } } }
    expect(load()(input)).toBe(input)
  })
})
