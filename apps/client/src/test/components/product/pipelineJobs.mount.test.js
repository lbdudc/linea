import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'

vi.mock('src/boot/axios', () => ({ api: {} }))
const productService = vi.hoisted(() => ({ getJobTrace: vi.fn(), cancelJob: vi.fn(), cancelPipeline: vi.fn() }))
vi.mock('src/services/productService', () => ({ default: productService }))
vi.mock('src/composables/useNotify', () => ({ notify: vi.fn(), errorMessage: (e) => e.message }))

const PipelineJobs = (await import('components/product/PipelineJobs.vue')).default
const mountIt = (props) => mount(PipelineJobs, { props: { productId: 'p1', openFailed: false, ...props }, attachTo: document.body, global: { plugins: mountGlobalPlugins() } })
afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks() })

const jobs = [
  { id: 1, name: 'lint', stage: 'check', status: 'success', duration: 10 },
  { id: 2, name: 'build', stage: 'build', status: 'running', duration: 30 },
  { id: 3, name: 'test', stage: 'test', status: 'pending', duration: null },
]

describe('PipelineJobs: the time of a job', () => {
  const timeOf = (wrapper, name) => wrapper.find(`[name="pjob-${name}"] .pjobs__time`).text()

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('counts the seconds of a running job, and only of those', async () => {
    const wrapper = mountIt({ jobs })
    expect(timeOf(wrapper, 'build')).toBe('30s')
    await vi.advanceTimersByTimeAsync(3000)
    expect(timeOf(wrapper, 'build')).toBe('33s')
    expect(timeOf(wrapper, 'lint')).toBe('10s')
    expect(timeOf(wrapper, 'test')).toBe('')
    wrapper.unmount()
  })

  it('follows what the host says, without going back, and stops when the job ends', async () => {
    const wrapper = mountIt({ jobs })
    await vi.advanceTimersByTimeAsync(5000)
    await wrapper.setProps({ jobs: jobs.map((job) => (job.id === 2 ? { ...job, duration: 33 } : job)) })
    expect(timeOf(wrapper, 'build')).toBe('35s')
    await wrapper.setProps({ jobs: jobs.map((job) => (job.id === 2 ? { ...job, duration: 40 } : job)) })
    expect(timeOf(wrapper, 'build')).toBe('40s')
    await vi.advanceTimersByTimeAsync(1000)
    expect(timeOf(wrapper, 'build')).toBe('41s')
    await wrapper.setProps({ jobs: jobs.map((job) => (job.id === 2 ? { ...job, status: 'failed', duration: 41 } : job)) })
    await vi.advanceTimersByTimeAsync(5000)
    expect(timeOf(wrapper, 'build')).toBe('41s')
    wrapper.unmount()
  })

  it('does not count once the jobs are no longer being followed', async () => {
    const wrapper = mountIt({ jobs, live: false })
    await vi.advanceTimersByTimeAsync(5000)
    expect(timeOf(wrapper, 'build')).toBe('30s')
    wrapper.unmount()
  })
})

describe('PipelineJobs: canceling', () => {
  it('offers to stop only the jobs that have not finished, and asks the page to read them again', async () => {
    productService.cancelJob.mockResolvedValue({ canceled: true })
    const wrapper = mountIt({ jobs })
    expect(wrapper.find('[name="pjob-cancel-lint"]').exists()).toBe(false)
    await wrapper.find('[name="pjob-cancel-build"]').trigger('click')
    await flushPromises()
    expect(productService.cancelJob).toHaveBeenCalledWith({ id: 'p1', jobId: 2 })
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('stops the whole pipeline from one button while something is still running', async () => {
    productService.cancelPipeline.mockResolvedValue({ canceled: true })
    const wrapper = mountIt({ jobs, pipelineId: 9034 })
    await wrapper.find('[name="pipeline-cancel"]').trigger('click')
    await flushPromises()
    expect(productService.cancelPipeline).toHaveBeenCalledWith({ id: 'p1', pipelineId: 9034 })
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('has nothing to stop once every job is over', () => {
    const wrapper = mountIt({ jobs: [{ id: 1, name: 'lint', stage: 'check', status: 'success', duration: 10 }], pipelineId: 9034 })
    expect(wrapper.find('[name="pipeline-cancel"]').exists()).toBe(false)
  })
})
