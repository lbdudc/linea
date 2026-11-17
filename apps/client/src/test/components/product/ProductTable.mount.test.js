import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import ProductTable from 'components/product/ProductTable.vue'

const PORTFOLIO = vi.hoisted(() => [
  { _id: 'p1', name: 'prod-alpha', version: '1.0.0', line: 'linea-a', createdAt: '2026-02-01T00:00:00Z' },
  { _id: 'p2', name: 'prod-beta', version: '2.0.0', line: 'linea-b', createdAt: '2026-04-03T00:00:00Z' },
])

vi.mock('src/services/lineService', () => ({
  default: { findEnrolledLines: vi.fn().mockResolvedValue([]) },
}))
vi.mock('src/services/productService', () => ({
  default: {
    async getProductsSummary(a) { const [status, deployments, pipelines] = await Promise.all([this.getProductsStatus?.(a), this.getProductsDeployments?.(a), a.pipelines ? this.getProductsPipelines?.(a) : undefined]); return { status: status ?? {}, deployments: deployments ?? {}, pipelines } },
    findEnrolledLines: vi.fn().mockResolvedValue(PORTFOLIO),
    restoreProduct: vi.fn().mockResolvedValue({}),
    getProductsStatus: vi.fn(async ({ ids }) => Object.fromEntries(ids.map((id) => [id, { health: { valid: true }, conflicts: { conflictingMRs: 0 } }]))),
    getProductsDeployments: vi.fn(async ({ ids }) => Object.fromEntries(ids.map((id) => [id, { pending: id === 'p1', version: '1.0.0' }]))),
  },
}))

const ROWS = [
  {
    _id: 'p1', name: 'prod-alpha', version: '1.0.0', line: 'linea-a', createdAt: '01/02/2026',
    repo: { id: 1, webUrl: 'https://gitlab.example.com/sig/prod-alpha' },
  },
  {
    _id: 'p2', name: 'prod-beta', version: '2.0.0', line: 'linea-b', createdAt: '03/04/2026',
    repo: { id: 2, webUrl: 'https://gitlab.example.com/sig/prod-beta' },
  },
]

function mountTable(push = vi.fn(), rows = ROWS) {
  return mount(ProductTable, {
    attachTo: document.body,
    props: { tableData: rows, loading: false },
    global: {
      plugins: mountGlobalPlugins(),
      mocks: { $router: { push } },
    },
  })
}

describe('ProductTable — pantalla de Productos del rediseño', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('no deja ningún residuo de Quasar en el DOM montado', () => {
    const wrapper = mountTable()
    expect(wrapper.find('q-icon').exists()).toBe(false)
    expect(wrapper.find('q-table').exists()).toBe(false)
    expect(wrapper.text()).toContain('prod-alpha')
    expect(wrapper.text()).toContain('prod-beta')
  })

  it('filtra las filas por nombre', async () => {
    const wrapper = mountTable()
    await wrapper.find('input[type="text"]').setValue('beta')

    expect(wrapper.text()).toContain('prod-beta')
    expect(wrapper.text()).not.toContain('prod-alpha')
  })

  it('la fila navega al detalle del producto', async () => {
    const push = vi.fn()
    const wrapper = mountTable(push)

    await wrapper.findAll('tbody tr')[0].trigger('click')

    expect(push).toHaveBeenCalledWith('/products/p1')
  })

  it('la fecha de creación queda alineada con su título: en su celda no se empuja a la derecha', () => {
    const wrapper = mountTable()
    const index = wrapper.findAll('thead th').findIndex((th) => th.text() === 'Fecha de creación')
    const cell = wrapper.findAll('tbody tr')[0].findAll('td')[index]

    expect(cell.text()).toBe('01/02/2026')
    expect(cell.find('.cell-end').exists()).toBe(false)
  })

  it('cada producto enlaza a su repositorio, y abrirlo no lleva al detalle', async () => {
    const push = vi.fn()
    const wrapper = mountTable(push)
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)

    await wrapper.find('[name="spl-repository-1"]').trigger('click')

    expect(open).toHaveBeenCalledWith('https://gitlab.example.com/sig/prod-alpha', '_blank')
    expect(push).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('la lista no tiene icono de borrar: se borra desde la página del producto', () => {
    const wrapper = mountTable()
    expect(wrapper.find('[name^="product-delete-"]').exists()).toBe(false)
    expect(wrapper.find('.pi-trash').exists()).toBe(false)
  })

  it('un producto pendiente se recupera, y uno dentro de una línea pendiente pide recuperar antes la línea', async () => {
    const { default: productService } = await import('src/services/productService')
    const wrapper = mount(ProductTable, {
      attachTo: document.body,
      props: {
        tableData: ROWS,
        loading: false,
        inactiveProducts: [
          { _id: 'h:1', repoId: 1, name: 'suelto', canRestore: true, lineFirst: false, webUrl: 'https://x/1' },
          { _id: 'h:2', repoId: 2, name: 'en-linea', canRestore: true, lineFirst: true, webUrl: 'https://x/2' },
          { _id: 'h:3', repoId: 3, name: 'ajeno', canRestore: false, lineFirst: false, webUrl: 'https://x/3' },
        ],
      },
      global: { plugins: mountGlobalPlugins(), mocks: { $router: { push: vi.fn() } } },
    })
    wrapper.vm.statusFilter = 'inactive'
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[name="product-restore-h:2"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[name="product-restore-h:2"]').attributes('aria-label')).toContain('línea')
    expect(wrapper.find('[name="product-restore-h:3"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[name="product-restore-h:1"]').trigger('click')
    await new Promise((resolve) => setTimeout(resolve))

    expect(productService.restoreProduct).toHaveBeenCalledWith({ repoId: 1 })
    expect(wrapper.emitted('restored')).toHaveLength(1)
  })

  it('un producto sin línea avisa en naranja de que no está mantenido', () => {
    const wrapper = mountTable(vi.fn(), [{ ...ROWS[0], lineDeleted: true }, ROWS[1]])

    expect(wrapper.find('[name="product-unmaintained-p1"]').text()).toContain('Producto no mantenido')
    expect(wrapper.find('[name="product-unmaintained-p1"]').classes()).toContain('unmaintained-tag')
    expect(wrapper.find('[name="product-unmaintained-p2"]').exists()).toBe(false)
  })

  it('el nombre del producto NO va en serif: esa es de las líneas', () => {
    const wrapper = mountTable()
    expect(wrapper.find('.cell-name').exists()).toBe(false)
    expect(wrapper.text()).toContain('prod-alpha')
  })

  it('ya NO hay columna de identificador', () => {
    const wrapper = mountTable()
    expect(wrapper.text()).not.toContain('sig/prod-alpha')
    expect(wrapper.findAll('th').map((th) => th.text())).not.toContain('Identificador')
  })

  it('marca los productos con cambios guardados sin desplegar, y filtra por ellos', async () => {
    const wrapper = mountTable()
    await vi.waitFor(() => expect(wrapper.find('[name="product-pending"]').exists()).toBe(true))
    expect(wrapper.findAll('[name="product-pending"]').length).toBe(1)

    const pill = wrapper.findAll('button.pill').find((b) => b.text().startsWith('Sin desplegar'))
    await pill.trigger('click')
    expect(wrapper.text()).toContain('prod-alpha')
    expect(wrapper.text()).not.toContain('prod-beta')

    const clear = wrapper.find('.products-table__reset')
    expect(clear.exists()).toBe(true)
    await clear.trigger('click')
    expect(wrapper.text()).toContain('prod-beta')
  })

  it('no hay chip "Todos" de cambios: pulsar de nuevo el activo los muestra todos', async () => {
    const wrapper = mountTable()
    expect(wrapper.findAll('button.pill').map((b) => b.text())).not.toContain('Todos')

    const pill = () => wrapper.findAll('button.pill').find((b) => b.text().startsWith('Al día'))
    await pill().trigger('click')
    expect(pill().classes()).toContain('pill--active')
    await pill().trigger('click')
    expect(pill().classes()).not.toContain('pill--active')
    expect(wrapper.text()).toContain('prod-alpha')
    expect(wrapper.text()).toContain('prod-beta')
  })

  it('cada fila pinta el estado con su punto de color', () => {
    const wrapper = mountTable()
    const statuses = wrapper.findAll('.cell-status')
    expect(statuses.length).toBe(ROWS.length)
    expect(statuses[0].find('.cell-status__dot').exists()).toBe(true)
  })

  it('el desplegable ofrece "todas" más una entrada por línea presente', () => {
    const wrapper = mountTable()
    const options = wrapper.vm.lineOptions

    expect(options[0].value).toBe(null)
    expect(options.map((o) => o.value)).toEqual([null, 'linea-a', 'linea-b'])
  })

  it('filtrar por línea deja solo los productos de esa línea', async () => {
    const wrapper = mountTable()
    wrapper.vm.lineFilter = 'linea-b'
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('prod-beta')
    expect(wrapper.text()).not.toContain('prod-alpha')
  })

  describe('productos inactivos', () => {
    const INACTIVE = [
      { _id: 'gitlab:7', repoId: 7, gitHost: 'gitlab', name: 'prod-borrado', line: 'linea-borrada', version: '0.4.0', createdAt: '05/03/2024', path: 'g/linea-borrada/prod-borrado', webUrl: 'https://gitlab.example.com/g-deletion_scheduled-1/prod-borrado', deletesOn: new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10) },
      { _id: 'gitlab:8', repoId: 8, gitHost: 'gitlab', name: 'prod-otro', line: 'linea-otra', version: null, createdAt: '—', path: 'g/linea-otra/prod-otro', webUrl: 'https://gitlab.example.com/g/prod-otro', deletesOn: null },
    ]
    const mountInactive = (query, props = {}) => mount(ProductTable, {
      attachTo: document.body,
      props: { tableData: ROWS, loading: false, inactiveProducts: INACTIVE, ...props },
      global: { plugins: mountGlobalPlugins(), mocks: { $router: { push: vi.fn() }, $route: { query } } },
    })

    it('el chip los lista con su línea, los días que faltan y el enlace a su repositorio', async () => {
      const wrapper = mountInactive({})
      const pills = wrapper.findAll('button.pill')
      expect(pills[0].text()).toBe('Activos')
      expect(wrapper.text()).not.toContain('prod-borrado')

      await pills.find((b) => b.text() === 'Inactivos (2)').trigger('click')
      expect(wrapper.text()).toContain('prod-borrado')
      expect(wrapper.text()).toContain('linea-borrada')
      expect(wrapper.text()).not.toContain('prod-alpha')
      expect(wrapper.find('[name="product-deletion-gitlab:7"]').text()).toMatch(/^Faltan (40|41) días$/)
      expect(wrapper.find('[name="product-deletion-gitlab:8"]').text()).toBe('Pendiente de eliminación')

      const open = vi.spyOn(window, 'open').mockImplementation(() => null)
      await wrapper.find('[name="spl-repository-7"]').trigger('click')
      expect(open).toHaveBeenCalledWith('https://gitlab.example.com/g-deletion_scheduled-1/prod-borrado', '_blank')
      open.mockRestore()
    })

    it('tiene las columnas de los activos que tienen sentido para ellos, más la eliminación', () => {
      const wrapper = mountInactive({ status: 'inactive' })

      expect(wrapper.findAll('thead th').map((th) => th.text())).toEqual(['Producto', 'Línea', 'Versión', 'Fecha de creación', 'Eliminación', ''])

      const [known, unknown] = wrapper.findAll('tbody tr').map((row) => row.findAll('td').map((td) => td.text()))
      expect(known.slice(0, 4)).toEqual(['prod-borrado', 'linea-borrada', '0.4.0', '05/03/2024'])
      expect(unknown.slice(2, 4)).toEqual(['—', '—'])
    })

    it('mientras cargan muestra que están cargando, y dice que no hay solo cuando no los hay', async () => {
      const wrapper = mountInactive({ status: 'inactive' }, { inactiveProducts: [], inactiveLoading: true })
      expect(wrapper.find('tbody[aria-busy="true"]').exists()).toBe(true)
      expect(wrapper.text()).not.toContain('No hay productos pendientes de eliminación')

      await wrapper.setProps({ inactiveLoading: false })
      expect(wrapper.find('tbody[aria-busy="true"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('No hay productos pendientes de eliminación')
    })

    it('llegando desde una línea inactiva, muestra solo los productos de esa línea', () => {
      const wrapper = mountInactive({ status: 'inactive', line: 'linea-borrada' })
      expect(wrapper.text()).toContain('prod-borrado')
      expect(wrapper.text()).not.toContain('prod-otro')
    })

    it('llegando desde una línea activa, muestra solo los productos activos de esa línea', () => {
      const wrapper = mountInactive({ line: 'linea-a' })
      expect(wrapper.text()).toContain('prod-alpha')
      expect(wrapper.text()).not.toContain('prod-beta')
      expect(wrapper.text()).not.toContain('prod-borrado')
    })
  })

  it('sin filas pinta el estado vacío del diseño', () => {
    const wrapper = mountTable(vi.fn(), [])
    expect(wrapper.find('.design-table__empty').exists()).toBe(true)
  })
})
