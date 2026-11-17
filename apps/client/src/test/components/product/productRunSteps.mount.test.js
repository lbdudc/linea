import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import ProductRunSteps from 'components/product/ProductRunSteps.vue'
import RunDetail from 'components/cicd/RunDetail.vue'

const { logs, service } = vi.hoisted(() => ({
  logs: { find: vi.fn() },
  service: {
    getVersionPipelines: vi.fn().mockResolvedValue({}),
    getVersion: vi.fn().mockResolvedValue({ version: '1.0.1', spec: { basicData: {}, features: [] }, previous: null }),
    getPipeline: vi.fn().mockResolvedValue({ pipeline: null, jobs: [], failed: null }),
    getLatestMergeRequest: vi.fn().mockResolvedValue(null),
    getMergeRequest: vi.fn(),
    getJobTrace: vi.fn().mockResolvedValue({ trace: 'npm ERR! build failed' }),
    getPipelineById: vi.fn().mockResolvedValue({ jobs: [], failed: null }),
    listMergeRequests: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('src/services/logService', () => ({ default: logs }))
vi.mock('src/services/productService', () => ({ default: service }))

const settle = () => new Promise((resolve) => setTimeout(resolve, 60))
const run = { id: 'g1', kind: 'generation', productId: 'p', productName: 'Tienda', version: '1.0.1', outcome: 'warning', stage: 'checks', state: 'bad', at: new Date().toISOString() }
const failedChecks = [
  { message: 'log.generated_product', params: ['1.0.1'], type: 'success' },
  { message: 'log.created_merge_request', params: ['bigbang', 'main'], type: 'info' },
  { message: 'log.waiting_checks', type: 'info' },
  { message: 'log.checks_job_failed', params: ['client_build'], type: 'warning' },
]
const opened = { number: 3, kind: 'generation', state: 'opened', version: '1.0.1', pipeline: { status: 'canceled' } }

const mounted = []
const mountSteps = (requests = [opened]) => {
  const wrapper = mount(ProductRunSteps, { attachTo: document.body, props: { run, requests, host: 'gitlab' }, global: { plugins: mountGlobalPlugins() } })
  mounted.push(wrapper)
  return wrapper
}
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
})

describe('the two steps of a past generation, in the page', () => {
  it('stays in its place, with no dialog and nothing to close', async () => {
    logs.find.mockResolvedValue(failedChecks)
    const wrapper = mountSteps()
    await settle()
    expect(document.body.querySelector('.p-dialog')).toBeFalsy()
    expect(wrapper.find('[name="gr-step-generate"]').exists()).toBe(true)
    expect(wrapper.find('[name="gr-step-deploy"]').exists()).toBe(true)
    expect(wrapper.find('[name="gr-close"]').exists()).toBe(false)
  })

  it('waits for a decision while the checks of the request did not pass', async () => {
    logs.find.mockResolvedValue(failedChecks)
    const wrapper = mountSteps()
    await settle()
    expect(wrapper.find('[name="gr-step-deploy"]').classes()).toContain('gr__step-btn--waiting')
    expect(wrapper.find('[name="mr-checks"]').exists()).toBe(true)
  })

  it('does not ask for it once the request is over', async () => {
    logs.find.mockResolvedValue(failedChecks)
    const wrapper = mountSteps([{ ...opened, state: 'merged' }])
    await settle()
    expect(wrapper.find('[name="gr-step-deploy"]').classes()).not.toContain('gr__step-btn--waiting')
  })
})

describe('why the checks of a past generation failed', () => {
  const failedRequest = {
    number: 3, state: 'merged', webUrl: 'http://git/mr/3', failed: { id: 9, name: 'client_build', trace: '' }, pipeline: { id: 7, status: 'failed' },
    jobs: [{ id: 9, name: 'client_build', stage: 'build', status: 'failed' }, { id: 10, name: 'server_test', stage: 'test', status: 'success' }],
  }
  const listed = (state) => ({ number: 3, kind: 'generation', state, version: '1.0.1', pipeline: { id: 7, status: 'failed' } })

  it.each([
    ['merged anyway', 'merged', [...failedChecks, { message: 'log.merged_merge_request', params: ['bigbang', 'main'], type: 'success' }]],
    ['rejected', 'closed', [...failedChecks, { message: 'log.update_rejected', params: ['1.0.1'], type: 'warning' }]],
  ])('tells it when it was %s: the job that failed and what it printed', async (_case, state, messages) => {
    logs.find.mockResolvedValue(messages)
    service.getMergeRequest.mockResolvedValue({ ...failedRequest, state })
    const wrapper = mountSteps([listed(state)])
    await settle()
    expect(service.getMergeRequest).toHaveBeenCalledWith({ id: 'p', number: 3 })
    expect(wrapper.find('[name="mr-checks-reason"]').text()).toContain('client_build')
    expect(wrapper.find('[name="pjob-trace-client_build"]').text()).toContain('npm ERR! build failed')
    expect(wrapper.find('[name="pjob-server_test"]').exists()).toBe(true)
    expect(wrapper.find('[name="update-decision"]').exists()).toBe(false)
  })

  it('reads the checks of the request of that version, not the latest one', async () => {
    logs.find.mockResolvedValue(failedChecks)
    service.getLatestMergeRequest.mockClear()
    service.getMergeRequest.mockResolvedValue(failedRequest)
    mountSteps([{ ...listed('merged'), number: 4, version: '1.0.2' }, listed('merged')])
    await settle()
    expect(service.getMergeRequest).toHaveBeenCalledWith({ id: 'p', number: 3 })
    expect(service.getLatestMergeRequest).not.toHaveBeenCalled()
  })

  it('still lets a person decide what is waiting, with the same reason in its place', async () => {
    logs.find.mockResolvedValue(failedChecks)
    service.getMergeRequest.mockResolvedValue({ ...failedRequest, state: 'opened' })
    const wrapper = mountSteps([listed('opened')])
    await settle()
    expect(wrapper.find('[name="update-decision"]').text()).toContain('client_build')
    expect(wrapper.find('[name="mr-checks-reason"]').exists()).toBe(false)
  })

  it('shows no checks for a generation whose request ran none', async () => {
    logs.find.mockResolvedValue(failedChecks.slice(0, 2))
    service.getMergeRequest.mockClear()
    const wrapper = mountSteps([{ number: 3, kind: 'generation', state: 'merged', version: '1.0.1', pipeline: null }])
    await settle()
    expect(service.getMergeRequest).not.toHaveBeenCalled()
    expect(wrapper.find('[name="mr-checks"]').exists()).toBe(false)
  })
})

describe('the detail of a run', () => {
  const detail = (theRun, slots) => mount(RunDetail, { props: { run: theRun }, slots, global: { plugins: mountGlobalPlugins() } })

  it('gives its place to the steps of a generation, when the page has them', async () => {
    const wrapper = detail(run, { steps: '<div name="the-steps" />' })
    await settle()
    expect(wrapper.find('[name="the-steps"]').exists()).toBe(true)
    expect(wrapper.find('[name="cicd-run-summary"]').exists()).toBe(false)
    expect(wrapper.find('[name="cicd-run-checks"]').exists()).toBe(false)
  })

  it('keeps its boxes for a sync and when the page has no steps', async () => {
    const sync = detail({ ...run, id: 's1', kind: 'sync', status: 'unchanged' }, { steps: '<div name="the-steps" />' })
    await settle()
    expect(sync.find('[name="the-steps"]').exists()).toBe(false)
    expect(sync.find('[name="cicd-run-summary"]').exists()).toBe(true)
    const plain = detail(run)
    await settle()
    expect(plain.find('[name="cicd-run-checks"]').exists()).toBe(true)
  })

  it('keeps its boxes for a generation that is still going', async () => {
    const live = detail({ ...run, id: 'l1', live: true }, { steps: '<div name="the-steps" />' })
    await settle()
    expect(live.find('[name="the-steps"]').exists()).toBe(false)
    expect(live.find('[name="cicd-run-summary"]').exists()).toBe(true)
  })
})
