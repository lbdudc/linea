import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import GenerationRecord from 'components/generation/GenerationRecord.vue'

vi.mock('src/services/logService', () => ({
  default: {
    findVersions: vi.fn().mockResolvedValue([]),
    find: vi.fn().mockResolvedValue([]),
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

describe('GenerationRecord — Dialog de PrimeVue bajo Teleport', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('el `div.p-dialog` teleportado no lleva data-v-* pero sí la anchura por `style` inline', async () => {
    mount(GenerationRecord, {
      attachTo: document.body,
      props: { id: 'prod-1', dialog: true },
      global: globalConTransicionReal(),
    })
    await esperarTransicionDialog()

    const dialogEl = document.body.querySelector('.p-dialog')
    expect(dialogEl).toBeTruthy()

    const llevaScopeId = [...dialogEl.attributes].some((a) => a.name.startsWith('data-v-'))
    expect(llevaScopeId).toBe(false)

    expect(dialogEl.getAttribute('style')).toContain('width: 100vw')
  })

  it('el botón de restaurar cambia la anchura a 900px sin depender de una clase scoped', async () => {
    const wrapper = mount(GenerationRecord, {
      attachTo: document.body,
      props: { id: 'prod-1', dialog: true },
      global: globalConTransicionReal(),
    })
    await esperarTransicionDialog()

    const restoreButton = document.body.querySelector('.generation-record__header-btn')
    restoreButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()

    const dialogEl = document.body.querySelector('.p-dialog')
    expect(dialogEl.getAttribute('style')).toContain('width: 900px')
  })

  it('Escape no lo cierra (equivalente al `persistent` original)', async () => {
    const wrapper = mount(GenerationRecord, {
      attachTo: document.body,
      props: { id: 'prod-1', dialog: true },
      global: globalConTransicionReal(),
    })
    await esperarTransicionDialog()

    pressEscape()
    await wrapper.vm.$nextTick()

    expect(document.body.querySelector('.p-dialog')).toBeTruthy()
  })
})
