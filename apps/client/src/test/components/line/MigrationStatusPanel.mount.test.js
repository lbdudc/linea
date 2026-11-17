import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import MigrationStatusPanel from 'components/line/MigrationStatusPanel.vue'

vi.mock('src/services/migrationService', () => ({
  default: {
    status: vi.fn().mockResolvedValue({
      summary: { valid: 1, invalid: 1, total: 2 },
      products: [
        { productId: 'p1', name: 'prod-ok', version: '1.0.0', status: 'valid' },
        { productId: 'p2', name: 'prod-bad', version: '2.0.0', status: 'invalid', reason: 'FM inválido' },
      ],
    }),
  },
}))
vi.mock('src/services/productService', () => ({
  default: {
    getProductConflicts: vi.fn().mockResolvedValue({ conflictingMRs: 0 }),
    getProductsStatus: vi.fn().mockImplementation(async ({ ids }) => Object.fromEntries(ids.map((id) => [id, { health: { valid: true }, conflicts: { conflictingMRs: id === 'p1' ? 2 : 0 } }]))),
    generateProduct: vi.fn(),
  },
}))

function pressEscape() {
  window.document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
}

async function esperarTransicionDialog() {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

function globalConTransicionReal() {
  return { plugins: mountGlobalPlugins(), stubs: { transition: false } }
}

describe('MigrationStatusPanel — Dialog persistent de PrimeVue bajo Teleport', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('Escape lo cierra (ya no es `persistent`: el análisis se puede abandonar)', async () => {
    const wrapper = mount(MigrationStatusPanel, {
      attachTo: document.body,
      props: { dialog: true, lineId: 'line-1' },
      global: globalConTransicionReal(),
    })
    await esperarTransicionDialog()

    pressEscape()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:dialog')?.[0]).toEqual([false])
  })

  it('un clic en el fondo tampoco lo cierra (`dismissable-mask="false"`)', async () => {
    const wrapper = mount(MigrationStatusPanel, {
      attachTo: document.body,
      props: { dialog: true, lineId: 'line-1' },
      global: globalConTransicionReal(),
    })
    await esperarTransicionDialog()

    const mask = document.body.querySelector('.p-dialog-mask')
    expect(mask).toBeTruthy()
    mask.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    mask.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    mask.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(document.body.querySelector('.p-dialog')).toBeTruthy()
    expect(wrapper.emitted('update:dialog')).toBeUndefined()
  })

  it('el ancho de 860px llega al `div.p-dialog` por `style`, no por clase scoped', async () => {
    mount(MigrationStatusPanel, {
      attachTo: document.body,
      props: { dialog: true, lineId: 'line-1' },
      global: globalConTransicionReal(),
    })
    await esperarTransicionDialog()

    const dialogEl = document.body.querySelector('.p-dialog')
    expect(dialogEl).toBeTruthy()

    expect([...dialogEl.attributes].some((a) => a.name.startsWith('data-v-'))).toBe(false)

    expect(dialogEl.classList.contains('mig-dialog')).toBe(true)
    expect(dialogEl.getAttribute('style')).toContain('width: 860px')
    expect(dialogEl.getAttribute('style')).toContain('max-width: 96vw')
  })

  it('pinta la tabla de veredicto sin residuo de Quasar (ningún `q-icon`, iconos `pi`)', async () => {
    const wrapper = mount(MigrationStatusPanel, {
      attachTo: document.body,
      props: { dialog: true, lineId: 'line-1' },
      global: globalConTransicionReal(),
    })
    await esperarTransicionDialog()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(document.body.querySelector('q-icon')).toBeNull()
    expect(document.body.querySelectorAll('.mig-row-chip .pi').length).toBeGreaterThan(0)
    expect(document.body.textContent).toContain('prod-ok')
    expect(document.body.textContent).toContain('prod-bad')
  })

  it('pide los conflictos de todos los productos en una sola petición, no una por producto', async () => {
    const productService = (await import('src/services/productService')).default
    productService.getProductsStatus.mockClear()
    productService.getProductConflicts.mockClear()
    const wrapper = mount(MigrationStatusPanel, {
      attachTo: document.body,
      props: { dialog: true, lineId: 'line-1' },
      global: globalConTransicionReal(),
    })
    await esperarTransicionDialog()
    await wrapper.vm.$nextTick()
    expect(productService.getProductsStatus).toHaveBeenCalledTimes(1)
    expect(productService.getProductsStatus.mock.calls[0][0].ids).toEqual(['p1', 'p2'])
    expect(productService.getProductConflicts).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('2')
  })

  it('cierra el diálogo con Escape mientras analiza y abandona la petición', async () => {
    const migrationService = (await import('src/services/migrationService')).default
    let signal
    migrationService.status.mockImplementationOnce((args) => { signal = args.signal; return new Promise(() => {}) })
    const wrapper = mount(MigrationStatusPanel, {
      attachTo: document.body,
      props: { dialog: true, lineId: 'line-1' },
      global: globalConTransicionReal(),
    })
    await esperarTransicionDialog()
    expect(signal.aborted).toBe(false)
    expect(document.body.querySelector('.mig-loading')).toBeTruthy()
    await wrapper.setProps({ dialog: false })
    expect(signal.aborted).toBe(true)
  })
})
