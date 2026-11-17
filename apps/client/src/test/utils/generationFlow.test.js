import { describe, it, expect } from 'vitest'
import { flowOf, hasFlow, packageName, logOfFlowNode } from 'src/utils/generationFlow'

const MAIN = 'gitlab:linea/modules/main-component'
const MAP = 'gitlab:linea/modules/map-viewer-component'
const BASIC = 'gitlab:linea/metamodels/basic'
const GIS = 'gitlab:linea/metamodels/gismodel'

const module = (location) => ({ message: 'log.resolving_module', params: [location, '1.0.0', []] })
const metamodel = (location, requiredBy) => ({ message: 'log.resolving_metamodel', params: [location, '1.0.0', requiredBy] })
const phase = (message) => ({ message })
const stateOf = (flow) => Object.fromEntries(flow.stages.map(({ key, state }) => [key, state]))
const states = (nodes) => nodes.map(({ state }) => state)

describe('the progress a generation log tells', () => {
  it('has the newest package downloading and the ones before it downloaded', () => {
    const flow = flowOf([module(MAIN), module(MAP)], 'running')
    expect(states(flow.modules)).toEqual(['done', 'downloading'])
    expect(flow.modules[0].name).toBe('main')
    expect(stateOf(flow)).toEqual({ check: 'pending', platform: 'pending', derive: 'pending' })
  })

  it('ties a metamodel to the modules that declare it, only those already there', () => {
    const flow = flowOf([module(MAIN), metamodel(BASIC, [MAIN, MAP])], 'running')
    expect(flow.links).toEqual([{ from: MAIN, to: BASIC, active: true }])
  })

  it('settles the links once the next package begins', () => {
    const flow = flowOf([module(MAIN), metamodel(BASIC, [MAIN]), metamodel(GIS, [])], 'running')
    expect(flow.links).toEqual([{ from: MAIN, to: BASIC, active: false }])
    expect(states(flow.metamodels)).toEqual(['done', 'downloading'])
  })

  it('counts a package once however many times it is told', () => {
    expect(flowOf([module(MAIN), module(MAIN)], 'running').modules).toHaveLength(1)
  })

  it('goes through the phases, and every package is over when they start', () => {
    const flow = flowOf([module(MAIN), phase('log.checking_product'), phase('log.composing_platform')], 'running')
    expect(states(flow.modules)).toEqual(['done'])
    expect(stateOf(flow)).toEqual({ check: 'done', platform: 'active', derive: 'pending' })
  })

  it('has the last phase over when the code is made, before the run ends', () => {
    const log = [phase('log.checking_product'), phase('log.composing_platform'), phase('log.deriving_code')]
    expect(stateOf(flowOf(log, 'running')).derive).toBe('active')
    expect(stateOf(flowOf([...log, phase('log.prettied_code')], 'running')).derive).toBe('done')
  })

  it('marks where it failed: the phase, or the package being downloaded', () => {
    expect(stateOf(flowOf([phase('log.checking_product')], 'failed'))).toEqual({ check: 'failed', platform: 'pending', derive: 'pending' })
    const flow = flowOf([module(MAIN), module(MAP)], 'failed')
    expect(states(flow.modules)).toEqual(['done', 'failed'])
    expect(stateOf(flow).check).toBe('pending')
  })

  it('has everything done for a finished run, also a log from before the phases were told', () => {
    const flow = flowOf([module(MAIN)], 'done')
    expect(states(flow.modules)).toEqual(['done'])
    expect(stateOf(flow)).toEqual({ check: 'done', platform: 'done', derive: 'done' })
  })

  it('reads a log saved before metamodels said who needs them', () => {
    const flow = flowOf([module(MAIN), { message: 'log.resolving_metamodel', params: [BASIC, '1.0.0'] }], 'done')
    expect(flow.metamodels).toHaveLength(1)
    expect(flow.links).toEqual([])
  })

  it('says whether there is anything to draw', () => {
    expect(hasFlow([phase('log.downloaded_spl')])).toBe(false)
    expect(hasFlow([module(MAIN)])).toBe(true)
  })

  it('names a package by the end of its location', () => {
    expect(packageName('gitlab:a/b/user-management-component')).toBe('user-management')
    expect(packageName(BASIC)).toBe('basic')
  })
})

describe('what the log says of each node', () => {
  const resolving = { message: 'log.resolving_module', params: ['lbdudc/main-component', '1.0.0'] }
  const other = { message: 'log.resolving_module', params: ['lbdudc/map-component', '1.0.0'] }
  const deriving = { message: 'log.deriving_code' }
  const made = { message: 'log.generated_product' }
  const error = { message: 'error_messages.internal_error', type: 'error' }

  it('tells each package by its location', () => {
    expect(logOfFlowNode([resolving, other], 'running', 'lbdudc/main-component')).toEqual([resolving])
  })

  it('gathers what ends a stage with what began it', () => {
    expect(logOfFlowNode([deriving, made], 'done', 'derive')).toEqual([deriving, made])
  })

  it('takes an error to the node that failed, and only to it', () => {
    expect(logOfFlowNode([resolving, other, error], 'failed', 'lbdudc/map-component')).toEqual([other, error])
    expect(logOfFlowNode([resolving, other, error], 'failed', 'lbdudc/main-component')).toEqual([resolving])
  })
})
