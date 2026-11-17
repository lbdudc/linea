import { describe, it, expect } from 'vitest'
import { buildCompositionGraph, pathsThrough, SPL_ID } from 'components/modules/compositionGraph'

const mod = (name, requiredBy, extra = {}) => ({
  kind: 'module', location: `gitlab:g/${name}`, name, version: '1.0.0', requiredBy,
  needs: { modules: [], metamodels: [] }, offers: [], ...extra,
})
const meta = (name, requiredBy) => ({ kind: 'metamodel', location: `gitlab:g/mm/${name}`, name, version: '2.0.0', requiredBy, needs: { modules: [], metamodels: [] }, offers: [] })

const nameOf = (l) => l.replace(/^gitlab:/, '').split('/').pop()
const chosenOf = (...names) => names.map((n) => ({ location: `gitlab:g/${n}`, range: '^1.0.0' }))
const edgeIds = (graph) => graph.edges.map((e) => e.id).sort()

describe('buildCompositionGraph', () => {
  it('is empty when nothing is chosen and nothing resolved', () => {
    expect(buildCompositionGraph({ packages: [], chosen: [] })).toEqual({ nodes: [], edges: [], cycle: false })
  })

  it('hangs the chosen modules from the SPL root and the metamodels from the modules that need them', () => {
    const graph = buildCompositionGraph({
      splName: 'gis',
      chosen: chosenOf('map'),
      nameOf,
      packages: [mod('map', ['spl'], { offers: ['gis'] }), meta('gismodel', ['gitlab:g/map@1.0.0'])],
    })
    expect(edgeIds(graph)).toEqual(['__spl__->gitlab:g/map', 'gitlab:g/map->gitlab:g/mm/gismodel'].sort())
    const root = graph.nodes.find((n) => n.id === SPL_ID)
    expect(root).toMatchObject({ type: 'spl', label: 'gis' })
    expect(graph.nodes.find((n) => n.label === 'map')).toMatchObject({ status: 'chosen', range: '^1.0.0', offers: ['gis'] })
    expect(graph.nodes.find((n) => n.label === 'gismodel')).toMatchObject({ type: 'metamodel' })
  })

  it('strips the version from who requires a package, so transitive modules link to the module that needs them', () => {
    const graph = buildCompositionGraph({
      chosen: chosenOf('map'),
      nameOf,
      packages: [mod('map', ['spl']), mod('main', ['gitlab:g/map@1.2.3'])],
    })
    expect(edgeIds(graph)).toContain('gitlab:g/map->gitlab:g/main')
  })

  it('marks a module nobody chose as missing, and a chosen one the answer lacks as unresolved', () => {
    const graph = buildCompositionGraph({
      chosen: chosenOf('map', 'ghost'),
      nameOf,
      packages: [mod('map', ['spl']), mod('main', ['gitlab:g/map@1.0.0'])],
    })
    expect(graph.nodes.find((n) => n.label === 'main').status).toBe('missing')
    const ghost = graph.nodes.find((n) => n.id === 'gitlab:g/ghost')
    expect(ghost).toMatchObject({ status: 'unresolved', version: null })
    expect(edgeIds(graph)).toContain('__spl__->gitlab:g/ghost')
  })

  it('draws a circular requirement from the message even without packages', () => {
    const graph = buildCompositionGraph({
      chosen: chosenOf('a'),
      nameOf,
      packages: [],
      messages: ['Circular requirement: gitlab:g/a -> gitlab:g/b -> gitlab:g/a'],
    })
    expect(graph.cycle).toBe(true)
    const cycleEdges = graph.edges.filter((e) => e.cycle).map((e) => e.id).sort()
    expect(cycleEdges).toEqual(['gitlab:g/a->gitlab:g/b', 'gitlab:g/b->gitlab:g/a'])
    expect(graph.nodes.find((n) => n.id === 'gitlab:g/b')).toMatchObject({ status: 'cycle', inCycle: true })
  })

  it('lays the SPL out left of its modules and the modules left of their metamodels', () => {
    const graph = buildCompositionGraph({
      chosen: chosenOf('map'),
      nameOf,
      packages: [mod('map', ['spl']), meta('gismodel', ['gitlab:g/map@1.0.0'])],
    })
    const x = (id) => graph.nodes.find((n) => n.id === id).position.x
    expect(x(SPL_ID)).toBeLessThan(x('gitlab:g/map'))
    expect(x('gitlab:g/map')).toBeLessThan(x('gitlab:g/mm/gismodel'))
  })
})

describe('pathsThrough', () => {
  const edges = [
    { source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'a', target: 'd' }, { source: 'x', target: 'y' },
  ]

  it('collects what a node reaches and what reaches it, and nothing else', () => {
    expect([...pathsThrough('b', edges)].sort()).toEqual(['a', 'b', 'c'])
    expect([...pathsThrough('x', edges)].sort()).toEqual(['x', 'y'])
  })
})
