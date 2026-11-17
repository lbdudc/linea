import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import AttentionInbox from 'components/home/AttentionInbox.vue'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRouter: () => ({ push }) }))
vi.mock('src/components/line/MigrationStatusPanel.vue', () => ({ default: { name: 'MigrationStatusPanel', props: ['dialog', 'lineId'], template: '<div class="migration" />' } }))

const item = (id, extra = {}) => ({
  id,
  name: `product-${id}`,
  line: 'line-a',
  lineId: 'l1',
  severity: 3,
  since: Date.now() - 3600_000,
  kinds: ['fail'],
  reasons: [{ key: 'generation', tone: 'bad' }, { key: 'pipeline', tone: 'bad' }],
  action: { key: 'view_error', tab: 'cicd', needsMigration: false },
  ...extra,
})

const COUNTS = { all: 2, fail: 1, conflict: 1, deploy: 0, stale: 0 }

function mountInbox(props = {}) {
  return mount(AttentionInbox, {
    props: { items: [item('a')], total: 2, counts: COUNTS, loading: false, ...props },
    global: { plugins: mountGlobalPlugins(), stubs: { 'router-link': RouterLinkStub } },
  })
}

describe('AttentionInbox', () => {
  beforeEach(() => push.mockClear())

  it('draws one row per product with every reason as a chip', () => {
    const wrapper = mountInbox()
    const rows = wrapper.findAll('.inbox__row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('product-a')
    expect(rows[0].text()).toContain('line-a')
    expect(rows[0].findAll('.inbox__reason').map((chip) => chip.text())).toEqual(['Generación fallida', 'Pipeline fallido'])
  })

  it('shows the total and the count of each filter', () => {
    const wrapper = mountInbox()
    expect(wrapper.find('.inbox__title').text()).toContain('2')
    expect(wrapper.find('[name="inbox-filter-fail"]').text()).toBe('Fallos 1')
    expect(wrapper.find('[name="inbox-filter-conflict"]').text()).toBe('Conflictos 1')
  })

  it('asks for another filter by the chip', async () => {
    const wrapper = mountInbox()
    await wrapper.find('[name="inbox-filter-conflict"]').trigger('click')
    expect(wrapper.emitted('update:filter')[0]).toEqual(['conflict'])
  })

  it('goes to the tab of the action when its button is pressed', async () => {
    const wrapper = mountInbox()
    await wrapper.find('[name="inbox-action-a"]').trigger('click')
    expect(push).toHaveBeenCalledWith('/products/a?tab=cicd')
  })

  it('opens the migration panel for a model that needs it', async () => {
    const wrapper = mountInbox({ items: [item('a', { action: { key: 'resolve', tab: null, needsMigration: true } })] })
    await wrapper.find('[name="inbox-action-a"]').trigger('click')
    expect(push).not.toHaveBeenCalled()
    expect(wrapper.find('.migration').exists()).toBe(true)
  })

  it('narrows the rows by the name of the product or of its line', async () => {
    const wrapper = mountInbox({ items: [item('a'), item('b', { name: 'other-thing', line: 'line-z' })] })
    expect(wrapper.findAll('.inbox__row')).toHaveLength(2)

    await wrapper.find('[name="inbox-search"]').setValue('OTHER')
    expect(wrapper.findAll('.inbox__row').map((row) => row.text())).toEqual([expect.stringContaining('other-thing')])

    await wrapper.find('[name="inbox-search"]').setValue('line-a')
    expect(wrapper.findAll('.inbox__row')).toHaveLength(1)

    await wrapper.find('[name="inbox-search"]').setValue('nothing matches')
    expect(wrapper.findAll('.inbox__row')).toHaveLength(0)
    expect(wrapper.find('.inbox__none').exists()).toBe(true)
  })

  it('says everything is healthy, and nothing else, when there is nothing to do', () => {
    const wrapper = mountInbox({ items: [], total: 0, counts: {} })
    expect(wrapper.find('[name="inbox-healthy"]').text()).toBe('Todo sano')
    expect(wrapper.find('.inbox__filters').exists()).toBe(false)
  })

  it('does not say it is healthy while it is still loading', () => {
    const wrapper = mountInbox({ items: [], total: 0, loading: true })
    expect(wrapper.find('[name="inbox-healthy"]').exists()).toBe(false)
  })

  it('says so when a filter leaves nothing', () => {
    const wrapper = mountInbox({ items: [] })
    expect(wrapper.find('.inbox__none').exists()).toBe(true)
  })
})
