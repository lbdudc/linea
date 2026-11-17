import { describe, it, expect, beforeEach } from 'vitest'
import store from 'stores/productState'

// What an older product stored for a class diagram and a sensor DSL, which are not edited with this page any more
const LEGACY = {
  dataModel: { cells: [{ id: 'a', type: 'custom.Class', name: 'Road', properties: [] }] },
  sensor: { dsl: 'CREATE PRODUCT demo USING 4326;', parsed: { features: ['SensorViewer'], data: {} } },
}

const spec = (extra = {}) => ({ basicData: { name: 'shop', version: '1.0.0' }, features: [], statics: [], ...extra })

beforeEach(() => {
  store.clear()
})

describe('the state of a product', () => {
  it('keeps the features of the product as the server has them: they are the index of its feature selection, a model of its own', () => {
    store.load(spec({ features: ['shop', 'card'], statics: ['a'] }))
    expect(store.getSpec()).toMatchObject({ features: ['shop', 'card'], statics: ['a'] })
    store.clear()
    expect(store.getSpec().features).toEqual([])
  })

  it('gives back what an older product stored for models that are not edited here, so saving does not lose it', () => {
    store.load(spec(LEGACY))
    const saved = store.getSpec()
    expect(saved.dataModel).toEqual(LEGACY.dataModel)
    expect(saved.sensor).toEqual(LEGACY.sensor)
    // and in the same place: a page compares the saved spec with this one to know whether anything changed
    expect(Object.keys(saved).slice(-2)).toEqual(['dataModel', 'sensor'])
  })

  it('has nothing to give back for a product that never had them, and forgets them when it is cleared', () => {
    store.load(spec())
    expect(store.getSpec()).not.toHaveProperty('dataModel')
    expect(store.getSpec()).not.toHaveProperty('sensor')
    store.load(spec(LEGACY))
    store.clear()
    expect(store.getSpec()).not.toHaveProperty('dataModel')
  })

  it('takes the legacy data of the product it loads, not of the one before', () => {
    store.load(spec(LEGACY))
    store.load(spec({ dataModel: { cells: [] } }))
    expect(store.getSpec().dataModel).toEqual({ cells: [] })
    expect(store.getSpec()).not.toHaveProperty('sensor')
  })
})
