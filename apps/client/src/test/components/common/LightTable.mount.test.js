import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import LightTable from 'components/common/LightTable.vue'

const COLUMNS = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'size', header: 'Size', class: 'col-wide' },
]
const ROWS = [
  { _id: 'a', name: 'beta', size: 2 },
  { _id: 'b', name: 'alpha', size: 1 },
  { _id: 'c', name: 'gamma', size: null },
]

const mountTable = (props = {}, slots = {}) => mount(LightTable, {
  props: { columns: COLUMNS, rows: ROWS, ...props },
  slots,
  global: { plugins: mountGlobalPlugins() },
})
const names = (wrapper) => wrapper.findAll('tbody tr').map((row) => row.findAll('td')[0].text())

describe('LightTable', () => {
  it('draws a row per item with the cell slot or the field', () => {
    const wrapper = mountTable({}, { 'cell-size': '<template #cell-size="{ row }">#{{ row.size }}</template>' })
    expect(names(wrapper)).toEqual(['beta', 'alpha', 'gamma'])
    expect(wrapper.findAll('tbody tr')[0].findAll('td')[1].text()).toBe('#2')
  })

  it('sorts by the asked field and by a header click (asc, desc, off)', async () => {
    const wrapper = mountTable({ sortField: 'name', sortOrder: 1 })
    expect(names(wrapper)).toEqual(['alpha', 'beta', 'gamma'])
    await wrapper.find('th').trigger('click')
    expect(names(wrapper)).toEqual(['gamma', 'beta', 'alpha'])
    await wrapper.find('th').trigger('click')
    expect(names(wrapper)).toEqual(['beta', 'alpha', 'gamma'])
  })

  it('puts a missing value last whichever way it is sorted', () => {
    expect(names(mountTable({ sortField: 'size', sortOrder: 1 }))).toEqual(['alpha', 'beta', 'gamma'])
    expect(names(mountTable({ sortField: 'size', sortOrder: -1 }))).toEqual(['beta', 'alpha', 'gamma'])
  })

  it('pages the rows', async () => {
    const wrapper = mountTable({ perPage: 2 })
    expect(names(wrapper)).toEqual(['beta', 'alpha'])
    await wrapper.find('.p-paginator-next').trigger('click')
    expect(names(wrapper)).toEqual(['gamma'])
  })

  it('emits row-click for the row, not for a button inside it', async () => {
    const wrapper = mountTable({}, { 'cell-name': '<template #cell-name="{ row }"><button class="inner">{{ row.name }}</button></template>' })
    await wrapper.find('tbody tr').trigger('click')
    expect(wrapper.emitted('row-click')[0][0]._id).toBe('a')
    await wrapper.find('.inner').trigger('click')
    expect(wrapper.emitted('row-click')).toHaveLength(1)
  })

  it('shows ghost rows while loading with nothing yet, and the empty slot when there is nothing', () => {
    const loading = mountTable({ rows: [], loading: true, perPage: 3 })
    expect(loading.findAll('tbody tr.lt__ghost')).toHaveLength(3)
    const empty = mountTable({ rows: [] }, { empty: '<span class="none">nothing</span>' })
    expect(empty.find('.none').exists()).toBe(true)
  })

  it('selects rows', async () => {
    const wrapper = mountTable({ selectable: true })
    await wrapper.findAll('tbody input[type="checkbox"]')[1].setValue(true)
    expect(wrapper.emitted('update:selection')[0][0].map((r) => r._id)).toEqual(['b'])
  })
})
