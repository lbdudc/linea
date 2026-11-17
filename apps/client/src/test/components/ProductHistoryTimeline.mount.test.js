import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import ProductHistoryTimeline from 'components/generation/ProductHistoryTimeline.vue'

const OPTIONS = [{ label: 'v1.0.0', value: '1.0.0' }, { label: 'v0.1.0', value: '0.1.0' }]

const mountTimeline = (props = {}) =>
  mount(ProductHistoryTimeline, {
    props: { versions: ['1.0.0', '0.1.0'], options: OPTIONS, versionPipelines: { '1.0.0': { status: 'success' } }, ...props },
    attachTo: document.body,
    global: { plugins: mountGlobalPlugins() },
  })

afterEach(() => { document.body.innerHTML = '' })

describe('ProductHistoryTimeline', () => {
  it('lists the versions with the pipeline of the ones that have one', () => {
    const wrapper = mountTimeline()
    expect(wrapper.findAll('.timeline-item')).toHaveLength(2)
    expect(wrapper.find('[name="version-pipeline-1.0.0"]').exists()).toBe(true)
    expect(wrapper.find('[name="version-pipeline-0.1.0"]').exists()).toBe(false)
  })

  it('tells the page what is asked of a version, and leaves doing it to the page', async () => {
    const wrapper = mountTimeline()
    await wrapper.find('[name="version-deployment-1.0.0"]').trigger('click')
    await wrapper.find('[name="version-spec-1.0.0"]').trigger('click')
    await wrapper.find('[name="version-zip-0.1.0"]').trigger('click')
    await wrapper.find('[name="version-restore-0.1.0"]').trigger('click')
    await wrapper.find('.timeline-item__row').trigger('click')
    expect(wrapper.emitted('open-deployment')[0]).toEqual(['1.0.0'])
    expect(wrapper.emitted('export-spec')[0]).toEqual(['1.0.0'])
    expect(wrapper.emitted('export-zip')[0]).toEqual(['0.1.0'])
    expect(wrapper.emitted('restore')[0]).toEqual(['0.1.0'])
    expect(wrapper.emitted('toggle')[0]).toEqual(['1.0.0'])
  })

  it('compares only two different points', async () => {
    const wrapper = mountTimeline({ from: '0.1.0', to: '0.1.0' })
    expect(wrapper.find('[name="compare-run"]').attributes('disabled')).toBeDefined()
    await wrapper.setProps({ to: '1.0.0' })
    const run = wrapper.find('[name="compare-run"]')
    expect(run.attributes('disabled')).toBeUndefined()
    await run.trigger('click')
    expect(wrapper.emitted('compare')).toHaveLength(1)
  })

  it('shows the log of the expanded version', () => {
    const wrapper = mountTimeline({ expandedVersion: '1.0.0', logs: { '1.0.0': [{ type: 'info', message: 'done', createdAt: new Date().toISOString() }] } })
    expect(wrapper.find('.timeline-item--expanded .timeline-item__logs').exists()).toBe(true)
  })
})

describe('ProductHistoryTimeline with syncs', () => {
  const syncs = [
    { _id: 's3', version: '1.0.0', status: 'mr', trigger: 'cron', files: 3, mr: { number: 8, url: 'https://gl/mr/8' }, finishedAt: new Date().toISOString() },
    { _id: 's2', version: '0.1.0', status: 'unchanged', trigger: 'manual', files: 0, finishedAt: new Date().toISOString() },
    { _id: 's1', version: null, status: 'unchanged', trigger: 'cron', files: 0, finishedAt: new Date().toISOString() },
    { _id: 'busy', version: '1.0.0', status: 'running', trigger: 'cron', files: 0 },
  ]
  const order = (wrapper) => wrapper.findAll('.sync-row, .timeline-item').map((el) => (el.element.classList.contains('sync-row') ? el.attributes('name') : 'v'))

  it('puts each sync above the version the product was at, and those of no version at the top; a running one is not listed', () => {
    const wrapper = mountTimeline({ syncs })
    expect(order(wrapper)).toEqual(['sync-run-s1', 'sync-run-s3', 'v', 'sync-run-s2', 'v'])
  })

  it('shows only the versions, or only the syncs, as asked', () => {
    expect(order(mountTimeline({ syncs, filter: 'versions' }))).toEqual(['v', 'v'])
    const onlySyncs = mountTimeline({ syncs, filter: 'syncs' })
    expect(order(onlySyncs)).toEqual(['sync-run-s1', 'sync-run-s3', 'sync-run-s2'])
    expect(onlySyncs.find('[name="history-compare"]').exists()).toBe(false)
  })

  it('says what a sync did and links the request it opened', () => {
    const wrapper = mountTimeline({ syncs })
    const row = wrapper.find('[name="sync-run-s3"]')
    expect(row.text()).toContain('Merge request abierta')
    expect(row.text()).toContain('planificador')
    expect(row.find('a').attributes('href')).toBe('https://gl/mr/8')
  })
})
