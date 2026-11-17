import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import ModelImportDialog from 'components/product/ModelImportDialog.vue'

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
const body = () => document.body.textContent

describe('ModelImportDialog', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('says which models the spec changed, which it left as they were, and what failed', async () => {
    mount(ModelImportDialog, {
      attachTo: document.body,
      global: { plugins: mountGlobalPlugins() },
      props: {
        visible: true,
        report: {
          transformed: true,
          updated: ['basic', 'datamodel'],
          invalid: [{ metamodel: 'forms', count: 16, errors: ["3:8 duplicate form 'TODO'"] }],
          errors: ["The import mapping of 'security' failed: Cannot read properties of undefined (reading 'roles')"],
          skipped: ['settings'],
          after: { ok: true, errors: 0, diagnostics: [] },
        },
      },
    })
    await settle()
    expect(body()).toContain('transformation.js')
    expect(body()).toContain('2 modelos actualizados')
    expect(document.querySelector('[data-test="import-updated"]').textContent).toContain('datamodel')
    expect(document.querySelector('[data-test="import-invalid"]').textContent).toContain('forms')
    expect(body()).toContain('16 problemas')
    expect(document.querySelector('[data-test="import-failed"]').textContent).toContain('security')
    expect(document.querySelector('[data-test="import-skipped"]').textContent).toContain('settings')
    expect(body()).toContain('Todos los modelos del producto son válidos.')
  })

  it('says when the spec changed nothing, and lists what is wrong with the models', async () => {
    mount(ModelImportDialog, {
      attachTo: document.body,
      global: { plugins: mountGlobalPlugins() },
      props: { visible: true, report: { transformed: false, updated: [], invalid: [], errors: [], skipped: [], after: { ok: false, errors: 1, diagnostics: [{ severity: 'error', package: 'product', file: '.linea/models/lists.lists', message: '2:3 Could not resolve Order' }] } } },
    })
    await settle()
    expect(document.querySelector('[data-test="import-nothing"]')).not.toBeNull()
    expect(body()).toContain('Could not resolve Order')
  })
})
