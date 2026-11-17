import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import ProductCreationModal from 'components/product/ProductCreationModal.vue'

vi.mock('src/services/productService', () => ({
  default: { createProdWithConfig: vi.fn() },
}))

async function esperarTransicionDialog() {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

describe('ProductCreationModal — Dialog de PrimeVue bajo Teleport', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('el ancho de 400px llega al `div.p-dialog` por `style`, no por clase scoped', async () => {
    mount(ProductCreationModal, {
      attachTo: document.body,
      props: { visible: true, renaming: false, configurations: [] },
      global: {
        plugins: mountGlobalPlugins(),
        stubs: { transition: false },
        mocks: { $route: { params: { id: 'l1' }, query: {} } },
      },
    })
    await esperarTransicionDialog()

    const dialogEl = document.body.querySelector('.p-dialog')
    expect(dialogEl).toBeTruthy()

    expect([...dialogEl.attributes].some((a) => a.name.startsWith('data-v-'))).toBe(false)

    expect(dialogEl.classList.contains('pcmod-dialog')).toBe(true)
    expect(dialogEl.getAttribute('style')).toContain('width: 400px')
    expect(dialogEl.getAttribute('style')).toContain('max-width: 96vw')
  })
})
