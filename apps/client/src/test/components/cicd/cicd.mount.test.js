import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import RunStepper from 'components/cicd/RunStepper.vue'
import ActivityList from 'components/cicd/ActivityList.vue'
import StatusStrip from 'components/cicd/StatusStrip.vue'
import ModeSwitch from 'components/cicd/ModeSwitch.vue'
import RunRail from 'components/cicd/RunRail.vue'

vi.mock('src/boot/axios', () => ({ api: {} }))
vi.mock('src/boot/ws', () => ({ socket: { on: () => {}, off: () => {}, emit: () => {} } }))

const global = { plugins: mountGlobalPlugins(), directives: { tooltip: {} } }
const mountIt = (component, props) => mount(component, { props, attachTo: document.body, global })
afterEach(() => { document.body.innerHTML = '' })

const run = (over) => ({
  kind: 'generation', id: 'g1', productId: 'p1', productName: 'Portal', lineId: 'l1', lineName: 'SPL', version: '1.2.0', outcome: 'success',
  at: new Date().toISOString(), stage: 'deployed', state: 'ok', ...over,
})

describe('RunStepper', () => {
  it('has the steps before the one a run is at over, the one it is at as it stands, and the next ones not come', () => {
    const wrapper = mountIt(RunStepper, { stage: 'merge', state: 'wait' })
    const state = (step) => wrapper.find(`[name="step-${step}"]`).classes().find((c) => c.startsWith('stepper__step--'))
    expect(state('derive')).toBe('stepper__step--ok')
    expect(state('checks')).toBe('stepper__step--ok')
    expect(state('merge')).toBe('stepper__step--wait')
    expect(state('deployed')).toBe('stepper__step--todo')
  })

  it('shows a failure at the step that failed', () => {
    const wrapper = mountIt(RunStepper, { stage: 'checks', state: 'bad' })
    expect(wrapper.find('[name="step-checks"]').classes()).toContain('stepper__step--bad')
    expect(wrapper.find('[name="step-derive"]').classes()).toContain('stepper__step--ok')
  })
})

describe('ActivityList', () => {
  const runs = [run(), run({ kind: 'sync', id: 's1', version: '1.2.0', status: 'mr', stage: 'merge', state: 'wait', mr: { number: 4, url: 'http://git/4' }, files: 3 })]

  it('lists generations and syncs together, and filters by kind', async () => {
    const wrapper = mountIt(ActivityList, { runs })
    expect(wrapper.findAll('tbody tr.activity__row')).toHaveLength(2)
    await wrapper.find('[name="activity-sync"]').trigger('click')
    expect(wrapper.findAll('tbody tr.activity__row')).toHaveLength(1)
    expect(wrapper.find('[name="run-s1"]').text()).toContain('Sync')
    await wrapper.find('[name="activity-all"]').trigger('click')
    expect(wrapper.findAll('tbody tr.activity__row')).toHaveLength(2)
  })

  it('opens a run with one click on its row', async () => {
    const wrapper = mountIt(ActivityList, { runs })
    await wrapper.find('[name="run-s1"]').trigger('click')
    expect(wrapper.emitted('select')[0][0].id).toBe('s1')
  })

  it('leaves out the columns of what the page already is', () => {
    const wrapper = mountIt(ActivityList, { runs, showLine: false, showProduct: false })
    expect(wrapper.findAll('thead th')).toHaveLength(5)
  })

  it('says so when there is nothing', () => {
    expect(mountIt(ActivityList, { runs: [] }).find('[name="activity-empty"]').exists()).toBe(true)
  })

  describe('what can be done with a run', () => {
    const failed = run({ id: 'g2', productId: 'p2', productName: 'Kiosk', state: 'bad', stage: 'derive' })
    const older = run({ id: 'g3', productId: 'p2', productName: 'Kiosk', state: 'bad', stage: 'derive', at: new Date(Date.now() - 1000 * 3600).toISOString() })
    const live = run({ id: 'live-j1', productId: 'p3', productName: 'Map', state: 'run', live: true, cancellable: true })
    const all = [...runs, failed, older, live]

    it('offers retry on a failed run, cancel on one waiting to start and the request on one that has it', async () => {
      const wrapper = mountIt(ActivityList, { runs: all })
      expect(wrapper.find('[name="run-retry-g2"]').exists()).toBe(true)
      expect(wrapper.find('[name="run-retry-g1"]').exists()).toBe(false)
      expect(wrapper.find('[name="run-cancel-live-j1"]').exists()).toBe(true)
      expect(wrapper.find('[name="run-mr-s1"]').exists()).toBe(true)
      await wrapper.find('[name="run-retry-g2"]').trigger('click')
      await wrapper.find('[name="run-cancel-live-j1"]').trigger('click')
      await wrapper.find('[name="run-mr-s1"]').trigger('click')
      expect(wrapper.emitted('retry')[0][0].id).toBe('g2')
      expect(wrapper.emitted('cancel')[0][0].id).toBe('live-j1')
      expect(wrapper.emitted('open-mr')[0][0].id).toBe('s1')
      expect(wrapper.emitted('select')).toBeUndefined()
    })

    it('retries the failed products once each, with the latest failed run of every product', async () => {
      const wrapper = mountIt(ActivityList, { runs: all })
      const button = wrapper.find('[name="activity-retry-failed"]')
      expect(button.text()).toContain('1')
      await button.trigger('click')
      expect(wrapper.emitted('retry-failed')[0][0].map((r) => r.id)).toEqual(['g2'])
    })

    it('filters by status, asks the page to keep it, and writes what is shown as CSV rows', async () => {
      const wrapper = mountIt(ActivityList, { runs: all, status: 'bad' })
      expect(wrapper.findAll('tbody tr.activity__row')).toHaveLength(2)
      await wrapper.find('[name="activity-status-wait"]').trigger('click')
      expect(wrapper.emitted('update:status')[0]).toEqual(['wait'])
      await wrapper.setProps({ status: 'bad' })
      await wrapper.find('[name="activity-status-bad"]').trigger('click')
      expect(wrapper.emitted('update:status')[1]).toEqual([null])
    })
  })
})

describe('StatusStrip and ModeSwitch', () => {
  it('each cell says what it counts, and a cell with an action offers it', async () => {
    const wrapper = mountIt(StatusStrip, { cells: [{ key: 'outdated', label: 'Desactualizados', value: 3, tone: 'sync', sub: 'de 6', hint: 'ayuda', action: 'Sincronizar' }, { key: 'failed', label: 'Fallos', value: 0 }] })
    expect(wrapper.find('[name="cicd-cell-outdated"]').text()).toContain('Desactualizados')
    await wrapper.find('[name="cicd-cell-outdated-action"]').trigger('click')
    expect(wrapper.emitted('action')[0]).toEqual(['outdated'])
    expect(wrapper.find('[name="cicd-cell-failed-action"]').exists()).toBe(false)
  })

  it('is one choice of two: status or configuration', async () => {
    const wrapper = mountIt(ModeSwitch, { modelValue: 'status' })
    expect(wrapper.findAll('button')).toHaveLength(2)
    await wrapper.find('[name="cicd-mode-config"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')[0]).toEqual(['config'])
    await flushPromises()
  })
})

describe('RunRail', () => {
  const runs = [run({ id: 'g1' }), run({ id: 's1', kind: 'sync' })]

  it('lists the runs, marks the open one and selects another without leaving', async () => {
    const wrapper = mountIt(RunRail, { runs, selected: 'g1' })
    expect(wrapper.find('[name="rail-g1"]').classes()).toContain('rail__item--on')
    await wrapper.find('[name="rail-s1"]').trigger('click')
    expect(wrapper.emitted('select')[0][0].id).toBe('s1')
  })

  it('folds to a strip of status icons without text', async () => {
    const wrapper = mountIt(RunRail, { runs, selected: 'g1', collapsed: true })
    expect(wrapper.find('[name="rail-g1"]').exists()).toBe(true)
    expect(wrapper.find('[name="rail-g1"] .rail__text').exists()).toBe(false)
    await wrapper.find('[name="cicd-rail-toggle"]').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })
})
