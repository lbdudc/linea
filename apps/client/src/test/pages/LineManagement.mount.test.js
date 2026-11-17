import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'

const notifyMock = vi.hoisted(() => vi.fn())
vi.mock('src/composables/useNotify', async (importOriginal) => ({ ...(await importOriginal()), notify: notifyMock }))

const LINES = [
  {
    _id: 'l1', repoId: 101, gitHost: 'gitlab', name: 'linea-alpha', version: '1.0.0', createdAt: '2026-01-01T00:00:00Z', productCount: 1,
    webUrl: 'https://gitlab.example.com/sig-municipal/linea-alpha',
  },
  {
    _id: 'l2', name: 'linea-beta', version: '1.0.0', createdAt: '2026-01-02T00:00:00Z', productCount: 1,
    webUrl: 'https://gitlab.example.com/sig-municipal/linea-beta',
  },
  {
    _id: 'l3', name: 'linea-gamma', version: '1.0.0', createdAt: '2026-01-03T00:00:00Z', productCount: 0,
    webUrl: 'https://gitlab.example.com/sig-municipal/linea-gamma',
  },
]

const PRODUCTS = [
  { _id: 'p1', name: 'producto-alpha', line: 'linea-alpha', version: '1.0.0', createdAt: '2026-01-01T00:00:00Z' },
  { _id: 'p2', name: 'producto-beta', line: 'linea-beta', version: '1.0.0', createdAt: '2026-01-01T00:00:00Z' },
]

const INACTIVE = [
  { _id: 'gitlab:9', repoId: 9, gitHost: 'gitlab', productCount: 2, name: 'linea-con-plazo', kind: 'modular', version: '2.3.0', createdAt: '2024-03-05T10:00:00.000Z', path: 'grupo/linea-con-plazo', webUrl: 'https://gitlab.example.com/grupo-deletion_scheduled-3/linea-con-plazo', deletesOn: new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10) },
  { _id: 'gitlab:10', repoId: 10, gitHost: 'gitlab', productCount: 0, name: 'linea-sin-plazo', kind: 'plain', version: null, createdAt: null, path: 'grupo/linea-sin-plazo', webUrl: 'https://gitlab.example.com/grupo/linea-sin-plazo', deletesOn: null },
]

async function mountLineManagement(findInactiveLines = vi.fn().mockResolvedValue(INACTIVE)) {
  vi.resetModules()

  const getProductsStatus = vi.fn(async ({ ids }) => Object.fromEntries(
    ids.map((id) => [id, { health: { valid: id !== 'p1' }, conflicts: { conflictingMRs: 0 } }]),
  ))

  vi.doMock('src/services/lineService', () => ({
    default: { findEnrolledLines: vi.fn().mockResolvedValue(LINES), findInactiveLines },
  }))
  vi.doMock('src/services/productService', () => ({
    default: {
      async getProductsSummary(a) { const [status, deployments, pipelines] = await Promise.all([this.getProductsStatus?.(a), this.getProductsDeployments?.(a), a.pipelines ? this.getProductsPipelines?.(a) : undefined]); return { status: status ?? {}, deployments: deployments ?? {}, pipelines } },
      findEnrolledLines: vi.fn().mockResolvedValue(PRODUCTS),
      getProductsStatus,
    },
  }))

  const { default: LineManagement } = await import('pages/LineManagement.vue')

  const wrapper = mount(LineManagement, {
    attachTo: document.body,
    global: {
      plugins: mountGlobalPlugins(),
      mocks: { $router: { push: vi.fn() } },
    },
  })

  await vi.waitFor(() => {
    expect(getProductsStatus).toHaveBeenCalledTimes(1)
  }, { timeout: 10000 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  await wrapper.vm.$nextTick()

  return wrapper
}

describe('LineManagement — Lines screen of the redesign', () => {
  it('names the primary action "Crear línea"', async () => {
    const wrapper = await mountLineManagement()
    expect(wrapper.text()).toContain('Crear línea')
  }, 15000)

  it('the first pill says "Activas", and a line opens its repository without leaving the list', async () => {
    const wrapper = await mountLineManagement()
    expect(wrapper.findAll('.pill')[0].text()).toBe('Activas')

    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    await wrapper.find('[name="spl-repository-101"]').trigger('click')
    expect(open).toHaveBeenCalledWith('https://gitlab.example.com/sig-municipal/linea-alpha', '_blank')
    expect(wrapper.vm.$router.push).not.toHaveBeenCalled()
    open.mockRestore()

    await wrapper.find('[name="line-products-l1"]').trigger('click')
    expect(wrapper.vm.$router.push).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.$router.push).toHaveBeenCalledWith({ path: '/lines/l1', query: { tab: 'products' } })
  }, 15000)

  it('"Inactivas" shows it is loading until the lines arrive, and says there are none only when there are none', async () => {
    let answer
    const wrapper = await mountLineManagement(vi.fn(() => new Promise((resolve) => { answer = resolve })))
    await wrapper.findAll('.pill').find((pill) => pill.text() === 'Inactivas').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('tbody[aria-busy="true"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('No hay líneas pendientes de eliminación')

    answer([])
    await vi.waitFor(() => expect(wrapper.text()).toContain('No hay líneas pendientes de eliminación'))
    expect(wrapper.find('tbody[aria-busy="true"]').exists()).toBe(false)
  }, 15000)

  it('a failure loading "Inactivas" is not left to look like there are none: it says so', async () => {
    const wrapper = await mountLineManagement(vi.fn().mockRejectedValue(new Error('boom')))
    await vi.waitFor(() => expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' })))
    expect(wrapper.vm.inactiveLoading).toBe(false)
  }, 15000)

  it('lists under "Inactivas" the lines waiting to be deleted, with the time left when it is known', async () => {
    const wrapper = await mountLineManagement()
    await vi.waitFor(() => expect(wrapper.findAll('.pill').some((pill) => pill.text() === 'Inactivas (2)')).toBe(true))
    await wrapper.findAll('.pill').find((pill) => pill.text() === 'Inactivas (2)').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[name="line-deletion-gitlab:9"]').text()).toMatch(/^Faltan (40|41) días$/)
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    await wrapper.find('[name="spl-repository-9"]').trigger('click')
    expect(open).toHaveBeenCalledWith('https://gitlab.example.com/grupo-deletion_scheduled-3/linea-con-plazo', '_blank')
    open.mockRestore()
    expect(wrapper.find('[name="line-deletion-gitlab:10"]').text()).toBe('Pendiente de eliminación')
    expect(wrapper.text()).not.toContain('linea-alpha')
    expect(wrapper.find('[name="line-restore-gitlab:9"]').exists()).toBe(true)

    expect(wrapper.find('[name="line-products-gitlab:10"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[name="line-products-gitlab:9"]').trigger('click')
    expect(wrapper.vm.$router.push).toHaveBeenCalledWith({ path: '/products', query: { line: 'linea-con-plazo', status: 'inactive' } })
  }, 15000)

  it('"Inactivas" has the columns of the active lines that make sense for them, plus the deletion', async () => {
    const wrapper = await mountLineManagement()
    await vi.waitFor(() => expect(wrapper.findAll('.pill').some((pill) => pill.text() === 'Inactivas (2)')).toBe(true))
    await wrapper.findAll('.pill').find((pill) => pill.text() === 'Inactivas (2)').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('thead th').map((th) => th.text())).toEqual(['Nombre', 'Tipo de línea', 'Versión', 'Productos', 'Creada', 'Eliminación', ''])

    const [withData, withoutData] = wrapper.findAll('tbody tr')
    const cells = (row) => row.findAll('td').map((td) => td.text())
    expect(cells(withData)[0]).toContain('linea-con-plazo')
    expect(cells(withData)[1]).not.toBe('')
    expect(cells(withData)[2]).toBe('2.3.0')
    expect(cells(withData)[4]).toContain('2024')
    expect(cells(withoutData)[2]).toBe('—')
    expect(cells(withoutData)[4]).toBe('—')
  }, 15000)

  it('the kind filter also applies to "Inactivas"', async () => {
    const wrapper = await mountLineManagement()
    await vi.waitFor(() => expect(wrapper.findAll('.pill').some((pill) => pill.text() === 'Inactivas (2)')).toBe(true))
    await wrapper.findAll('.pill').find((pill) => pill.text() === 'Inactivas (2)').trigger('click')
    wrapper.findComponent({ name: 'LineTable' }).vm.kindFilter = 'modular'
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('linea-con-plazo')
    expect(wrapper.text()).not.toContain('linea-sin-plazo')
  }, 15000)

  it('the "con fallos" pill matches the count and the rows', async () => {
    const wrapper = await mountLineManagement()
    const pills = Array.from(wrapper.findAll('.pill'))
    const withIssues = pills.find((pill) => pill.text() === 'Requieren atención')

    await withIssues.trigger('click')
    await wrapper.vm.$nextTick()

    const rows = wrapper.findAll('tbody tr')
    expect(rows.length).toBe(1)
    expect(wrapper.text()).toContain('linea-alpha')
    expect(wrapper.text()).not.toContain('linea-beta')
    expect(wrapper.text()).toContain('1 de 3 líneas')
  }, 15000)

  it('a filter matching no line shows the empty state', async () => {
    const wrapper = await mountLineManagement()
    await wrapper.find('input[type="text"]').setValue('no-existe-esta-linea')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.design-table__empty').exists()).toBe(true)
    expect(wrapper.text()).toContain('Ninguna línea coincide con los filtros')
  }, 15000)

  it('no longer shows the GitLab path under the line name (the search still looks in it)', async () => {
    const wrapper = await mountLineManagement()
    expect(wrapper.find('.cell-path').exists()).toBe(false)

    await wrapper.find('input[type="text"]').setValue('sig-municipal/linea-alpha')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('tbody tr').length).toBe(1)
    expect(wrapper.text()).toContain('linea-alpha')
  }, 15000)
})
