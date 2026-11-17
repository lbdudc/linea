import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import MergeRequestChecks from 'components/product/MergeRequestChecks.vue'

const { service } = vi.hoisted(() => ({
  service: { getLatestMergeRequest: vi.fn(), getMergeRequest: vi.fn(), getJobTrace: vi.fn().mockResolvedValue({ trace: '' }) },
}))
vi.mock('src/services/productService', () => ({ default: service }))

const requestWith = (state, status, jobId) => ({
  number: 9, state, webUrl: '', failed: null, pipeline: { id: jobId, status },
  jobs: [{ id: jobId, name: 'client_build', stage: 'build', status }],
})

describe('the checks of a request that is over', () => {
  let wrapper
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    wrapper?.unmount()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })
  const mountIt = async () => {
    wrapper = mount(MergeRequestChecks, { attachTo: document.body, props: { productId: 'p' }, global: { plugins: mountGlobalPlugins() } })
    await vi.advanceTimersByTimeAsync(0)
  }

  it('go on being followed while the request is open: a new generation brings new checks', async () => {
    service.getLatestMergeRequest.mockReset()
    service.getLatestMergeRequest.mockResolvedValueOnce(requestWith('opened', 'failed', 1)).mockResolvedValue(requestWith('opened', 'running', 2))
    await mountIt()
    expect(wrapper.find('[name="pjob-client_build"]').text()).toContain('client_build')
    await vi.advanceTimersByTimeAsync(15000)
    expect(service.getLatestMergeRequest).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[name="pjob-client_build"]').classes().join(' ')).toContain('running')
  })

  it('stop being followed once the request is merged', async () => {
    service.getLatestMergeRequest.mockReset()
    service.getLatestMergeRequest.mockResolvedValue(requestWith('merged', 'success', 1))
    await mountIt()
    await vi.advanceTimersByTimeAsync(60000)
    expect(service.getLatestMergeRequest).toHaveBeenCalledTimes(1)
  })
})
