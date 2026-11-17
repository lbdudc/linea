import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import LineTable from 'components/line/LineTable.vue'
import { gitHosts } from 'stores/gitHosts'

vi.mock('src/services/lineService', () => ({
  default: { findEnrolledLines: vi.fn().mockResolvedValue([]), findLineById: vi.fn().mockResolvedValue({ products: [] }) },
}))
vi.mock('src/services/productService', () => ({
  default: {
    async getProductsSummary(a) { const [status, deployments, pipelines] = await Promise.all([this.getProductsStatus?.(a), this.getProductsDeployments?.(a), a.pipelines ? this.getProductsPipelines?.(a) : undefined]); return { status: status ?? {}, deployments: deployments ?? {}, pipelines } },
    findEnrolledLines: vi.fn().mockResolvedValue([]),
    getProductsStatus: vi.fn(async ({ ids }) => Object.fromEntries(ids.map((id) => [id, { health: { valid: true }, conflicts: { conflictingMRs: 0 } }]))),
  },
}))

const ROWS = [
  {
    _id: 'l1', name: 'linea-alpha', version: '1.0.0', createdAt: '01/02/2026', productCount: 3,
    repoId: 1, webUrl: 'https://gitlab.example.com/sig-municipal/linea-alpha',
  },
  {
    _id: 'l2', name: 'linea-beta', version: '2.1.0', createdAt: '03/04/2026', productCount: 0,
    repoId: 2, webUrl: 'https://gitlab.example.com/sig-municipal/linea-beta',
  },
]

function mountTable(push = vi.fn(), rows = ROWS) {
  return mount(LineTable, {
    attachTo: document.body,
    props: { tableData: rows, loading: false },
    global: {
      plugins: mountGlobalPlugins(),
      mocks: { $router: { push } },
    },
  })
}

describe('LineTable — Lines screen of the redesign', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('leaves no Quasar residue in the mounted DOM', () => {
    const wrapper = mountTable()
    expect(wrapper.find('q-icon').exists()).toBe(false)
    expect(wrapper.find('q-btn').exists()).toBe(false)
    expect(wrapper.find('q-table').exists()).toBe(false)
    expect(wrapper.text()).toContain('linea-alpha')
    expect(wrapper.text()).toContain('linea-beta')
  })

  it('filters rows by name', async () => {
    const wrapper = mountTable()
    await wrapper.find('input[type="text"]').setValue('alpha')

    expect(wrapper.text()).toContain('linea-alpha')
    expect(wrapper.text()).not.toContain('linea-beta')
  })

  it('shows the clear cross only with text, and clears the search', async () => {
    const wrapper = mountTable()
    expect(wrapper.find('.lines-table__clear').exists()).toBe(false)

    await wrapper.find('input[type="text"]').setValue('alpha')
    const clear = wrapper.find('.lines-table__clear')
    expect(clear.exists()).toBe(true)

    await clear.trigger('click')
    expect(wrapper.vm.filter).toBe('')
    expect(wrapper.text()).toContain('linea-beta')
  })

  it('a row click navigates to the line detail', async () => {
    const push = vi.fn()
    const wrapper = mountTable(push)

    await wrapper.findAll('tbody tr')[0].trigger('click')

    expect(push).toHaveBeenCalledWith('/lines/l1')
  })

  it('the list has no delete icon: a line is deleted from its own page', () => {
    const wrapper = mountTable()
    expect(wrapper.find('[name^="line-delete-"]').exists()).toBe(false)
    expect(wrapper.find('.pi-trash').exists()).toBe(false)
  })

  it('the old names of the row actions are gone', () => {
    const wrapper = mountTable()
    expect(wrapper.find('[name="spl-delete-l2"]').exists()).toBe(false)
    expect(wrapper.find('[name="spl-fm-l1"]').exists()).toBe(false)
  })

  it('the line name is set like the one of a product: plain, on one line, with no path under it', () => {
    const wrapper = mountTable()
    expect(wrapper.find('.cell-name').exists()).toBe(false)
    expect(wrapper.find('.cell-path').exists()).toBe(false)
    expect(wrapper.find('tbody .cell-truncated').text()).toBe('linea-alpha')
  })

  it('the identifier of the GitLab URL, without a leading slash, is still what the search looks in', async () => {
    const wrapper = mountTable()
    expect(wrapper.vm.identifier({ webUrl: 'https://gitlab.example.com/sig-municipal/linea-alpha' })).toBe('sig-municipal/linea-alpha')
    await wrapper.find('input[type="text"]').setValue('sig-municipal/linea-alpha')
    expect(wrapper.vm.filteredData.map((line) => line.name)).toEqual(['linea-alpha'])
  })

  it('a missing or invalid GitLab URL does not break the cell: shows —', () => {
    const wrapper = mountTable(vi.fn(), [
      { _id: 'l9', name: 'sin-url', version: '1.0.0', createdAt: '', productCount: 0 },
    ])
    expect(wrapper.vm.identifier({ name: 'x' })).toBe('—')
    expect(wrapper.vm.identifier({ webUrl: 'no-es-una-url' })).toBe('—')
    expect(wrapper.text()).toContain('sin-url')
  })

  it('each row paints the two-segment health bar', () => {
    const wrapper = mountTable()
    const bars = wrapper.findAll('.health-bar')
    expect(bars.length).toBe(ROWS.length)
    expect(bars[0].find('.health-bar__ok').exists()).toBe(true)
    expect(bars[0].find('.health-bar__bad').exists()).toBe(true)
  })

  it('offers to create the first product of a line that has none, and goes to its form', async () => {
    const push = vi.fn()
    const wrapper = mountTable(push)
    expect(wrapper.find('[name="line-first-product-l1"]').exists()).toBe(false)
    const button = wrapper.find('[name="line-first-product-l2"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(push).toHaveBeenCalledWith('/lines/l2/new-product')
    expect(push).not.toHaveBeenCalledWith('/lines/l2')
  })

  it('with no rows, paints the design empty state instead of a blank tbody', () => {
    const wrapper = mountTable(vi.fn(), [])
    expect(wrapper.find('.design-table__empty').exists()).toBe(true)
    expect(wrapper.text()).toContain('Ninguna línea coincide con los filtros')
  })

  it('the pills filter by status, and only one stays active', async () => {
    const wrapper = mountTable()
    const pills = wrapper.findAll('.pill')
    expect(pills.length).toBe(5)
    expect(pills[0].classes()).toContain('pill--active')

    await pills[2].trigger('click')
    expect(wrapper.vm.statusFilter).toBe('bad')
    expect(wrapper.findAll('.pill--active').length).toBe(1)
  })

  it('the "no products" pill only keeps lines with zero products', async () => {
    const wrapper = mountTable()
    const pills = wrapper.findAll('.pill')

    await pills[3].trigger('click')
    expect(wrapper.vm.statusFilter).toBe('no-products')
    expect(wrapper.vm.filteredData.map((line) => line.name)).toEqual(['linea-beta'])
  })
})

describe('LineTable — variant="dashboard" (dashboard screen, DataTable does the work)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function makeLines(n) {
    return Array.from({ length: n }, (_, i) => ({
      _id: `l${i}`, name: `line-${i}`, version: '1.0.0', createdAt: '2026-01-01T00:00:00Z',
      productCount: 1,
    }))
  }

  const BAD_LINES = ['line-0', 'line-1']

  const SYNCED_LINES = ['line-0', 'line-1', 'line-2']

  function makeProducts(lines) {
    return lines.map((line) => ({
      _id: `${line.name}-p0`, name: `${line.name}-p0`, line: line.name,
      version: '1.0.0', createdAt: '2026-01-01T00:00:00Z',
      lastSyncAt: SYNCED_LINES.includes(line.name) ? new Date().toISOString() : null,
    }))
  }

  async function mountDashboardVariant(rows) {
    vi.resetModules()

    const products = makeProducts(rows)
    const getProductsStatus = vi.fn(async ({ ids }) => Object.fromEntries(ids.map((id) => {
      const line = String(id).replace(/-p0$/, '')
      return [id, { health: { valid: !BAD_LINES.includes(line) }, conflicts: { conflictingMRs: 0 } }]
    })))

    vi.doMock('src/services/lineService', () => ({
      default: { findEnrolledLines: vi.fn().mockResolvedValue([]) },
    }))
    vi.doMock('src/services/productService', () => ({
      default: {
        async getProductsSummary(a) { const [status, deployments, pipelines] = await Promise.all([this.getProductsStatus?.(a), this.getProductsDeployments?.(a), a.pipelines ? this.getProductsPipelines?.(a) : undefined]); return { status: status ?? {}, deployments: deployments ?? {}, pipelines } },
        findEnrolledLines: vi.fn().mockResolvedValue(products),
        getProductsStatus,
      },
    }))

    const { default: LineTableFresh } = await import('components/line/LineTable.vue')

    const wrapper = mount(LineTableFresh, {
      attachTo: document.body,
      props: { tableData: rows, loading: false, variant: 'dashboard' },
      global: {
        plugins: mountGlobalPlugins(),
        mocks: { $router: { push: vi.fn() } },
      },
    })

    await vi.waitFor(() => {
      expect(getProductsStatus).toHaveBeenCalled()
    }, { timeout: 10000 })
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.vm.$nextTick()

    return wrapper
  }

  it('shows the Models column with — when the line has no models', async () => {
    const lines = makeLines(6)
    const wrapper = await mountDashboardVariant(lines)

    const headers = wrapper.findAll('th').map((h) => h.text())
    expect(headers.some((h) => h.includes('Modelos'))).toBe(true)

    const firstRowCells = wrapper.findAll('tbody tr')[0].findAll('td')
    expect(firstRowCells[3].text()).toBe('—')
  }, 15000)

  it('has three pills: all, with issues and unsynced', async () => {
    const lines = makeLines(6)
    const wrapper = await mountDashboardVariant(lines)

    const pills = wrapper.findAll('.pill')
    expect(pills.length).toBe(3)
  }, 15000)

  it('the "with issues" filter reduces the count and the matching rows', async () => {
    const lines = makeLines(6)
    const wrapper = await mountDashboardVariant(lines)

    const pills = wrapper.findAll('.pill')
    await pills[1].trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.filteredData.length).toBe(BAD_LINES.length)
    expect(wrapper.text()).toContain(`${BAD_LINES.length} de 6`)
    expect(wrapper.findAll('tbody tr').length).toBe(BAD_LINES.length)
  }, 15000)

  it('the unsynced filter keeps the lines whose products never synced', async () => {
    const lines = makeLines(6)
    const wrapper = await mountDashboardVariant(lines)

    const headers = wrapper.findAll('th').map((h) => h.text())
    expect(headers.some((h) => h.includes('Última sinc.'))).toBe(true)

    const pills = wrapper.findAll('.pill')
    await pills[2].trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.filteredData.length).toBe(lines.length - SYNCED_LINES.length)
    expect(wrapper.text()).toContain('Nunca')
  }, 15000)

  it('a filter matching no row paints the empty state', async () => {
    const lines = makeLines(6)
    const wrapper = await mountDashboardVariant(lines)

    const pills = wrapper.findAll('.pill')
    await pills[1].trigger('click')
    await wrapper.find('input[type="text"]').setValue('no-existe-esta-linea')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.design-table__empty').exists()).toBe(true)
  }, 15000)

  it('the sort dropdown offers the four orderings from the design', async () => {
    const lines = makeLines(6)
    const wrapper = await mountDashboardVariant(lines)

    expect(wrapper.vm.sortSelectOptions.map((o) => o.value)).toEqual([
      'issues', 'stale', 'products', 'name',
    ])
  }, 15000)

  it('"most issues first" sorts using the DataTable sort-field/sort-order, with no comparator of its own', async () => {
    const lines = makeLines(6)
    const wrapper = await mountDashboardVariant(lines)

    wrapper.vm.sortOption = 'issues'
    await wrapper.vm.$nextTick()

    const names = wrapper.findAll('.cell-name').map((n) => n.text())
    expect(BAD_LINES).toContain(names[0])
  }, 15000)
})

describe('LineTable — more than one git host', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    gitHosts.hosts = []
    gitHosts.primary = null
  })

  it('shows no mark of the git host, however many there are', async () => {
    gitHosts.hosts = [{ id: 'gitlab' }, { id: 'github' }]
    gitHosts.primary = 'gitlab'
    const wrapper = mountTable(vi.fn(), [{ ...ROWS[0], gitHost: 'github' }, ROWS[1]])
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.cell-host')).toHaveLength(0)
  })
})

describe('LineTable: the kinds of line', () => {
  const KINDS = [
    { ...ROWS[0], _id: 'a', name: 'simple', kind: 'plain' },
    { ...ROWS[0], _id: 'b', name: 'proyecto', kind: 'project' },
    { ...ROWS[0], _id: 'c', name: 'modular', kind: 'modular' },
    { ...ROWS[0], _id: 'd', name: 'antigua' },
  ]
  const shown = (wrapper) => wrapper.vm.filteredData.map((line) => line.name)

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('tags each one with its kind, a line that does not say being a plain one', async () => {
    const wrapper = mountTable(vi.fn(), KINDS)
    await wrapper.vm.$nextTick()
    const row = (name) => wrapper.findAll('tr').find((candidate) => candidate.text().includes(name))
    expect(row('simple').find('[name="line-kind-plain"]').text()).toBe('LPS')
    expect(row('proyecto').find('[name="line-kind-project"]').text()).toBe('Proyecto')
    expect(row('modular').find('[name="line-kind-modular"]').text()).toBe('Proyecto modular')
    expect(row('antigua').find('[name="line-kind-plain"]').exists()).toBe(true)
  })

  it.each([
    ['plain', ['simple', 'antigua']],
    ['project', ['proyecto']],
    ['modular', ['modular']],
    ['all', ['simple', 'proyecto', 'modular', 'antigua']],
  ])('filters by %s', async (kind, names) => {
    const wrapper = mountTable(vi.fn(), KINDS)
    wrapper.vm.kindFilter = kind
    await wrapper.vm.$nextTick()
    expect(shown(wrapper)).toEqual(names)
  })

  it('adds up with the other filters and is cleared with them', async () => {
    const wrapper = mountTable(vi.fn(), KINDS)
    wrapper.vm.kindFilter = 'project'
    wrapper.vm.filter = 'modular'
    await wrapper.vm.$nextTick()
    expect(shown(wrapper)).toEqual([])
    expect(wrapper.find('.lines-table__reset').exists()).toBe(true)
    await wrapper.find('.lines-table__reset').trigger('click')
    expect(wrapper.vm.kindFilter).toBe('all')
    expect(shown(wrapper)).toHaveLength(4)
  })
})
