import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import { diffSpecs } from 'src/utils/specDiff'
import PendingDeployChip from 'components/generation/PendingDeployChip.vue'
import SpecDiffDialog from 'components/generation/SpecDiffDialog.vue'

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('diffSpecs', () => {
  it('compares the features as a set and the rest field by field', () => {
    const before = { basicData: { name: 'P', version: '0.1.0' }, features: ['A', 'B'], statics: [] }
    const after = { basicData: { name: 'Q', version: '0.1.0' }, features: ['B', 'C'], statics: [{ id: 1 }] }

    const changes = diffSpecs(before, after)

    expect(changes).toContainEqual({ path: 'features', kind: 'added', after: 'C' })
    expect(changes).toContainEqual({ path: 'features', kind: 'removed', before: 'A' })
    expect(changes).toContainEqual({ path: 'basicData.name', kind: 'changed', before: 'P', after: 'Q' })
    expect(changes).toContainEqual({ path: 'statics', kind: 'changed', before: '0', after: '1', list: true })
    expect(changes.some((c) => c.path === 'basicData.version')).toBe(false)
  })

  it('says nothing when both are the same', () => {
    expect(diffSpecs({ a: { b: [1, 2] } }, { a: { b: [1, 2] } })).toEqual([])
  })
})

describe('PendingDeployChip', () => {
  afterEach(() => { document.body.innerHTML = '' })

  const mountChip = (deployment, props = {}) => mount(PendingDeployChip, {
    attachTo: document.body,
    props: { deployment, ...props },
    global: { plugins: mountGlobalPlugins() },
  })

  // what can be done is behind the tag: it is opened first
  const openChip = async (wrapper) => {
    await wrapper.find('[name="product-pending-deploy"]').trigger('click')
    await settle()
  }
  const inPanel = (name) => document.body.querySelector(`[name="${name}"]`)

  it('shows nothing when there is nothing pending', () => {
    const wrapper = mountChip({ pending: false, version: '1.0.0', restorable: true })
    expect(wrapper.find('[name="product-pending-deploy"]').exists()).toBe(false)
  })

  it('is a small tag, and offers its actions only once it is opened', async () => {
    const wrapper = mountChip({ pending: true, version: '1.0.0', restorable: true })
    expect(wrapper.find('[name="product-pending-deploy"]').exists()).toBe(true)
    expect(inPanel('pending-deploy-diff')).toBeNull()

    await openChip(wrapper)
    expect(inPanel('pending-deploy-diff')).toBeTruthy()
    wrapper.unmount()
  })

  it('offers the differences and the discard only when what was deployed is kept', async () => {
    const kept = mountChip({ pending: true, version: '1.0.0', restorable: true })
    await openChip(kept)
    expect(inPanel('pending-deploy-diff')).toBeTruthy()
    expect(inPanel('pending-deploy-discard')).toBeTruthy()
    kept.unmount()
    document.body.innerHTML = ''

    const notKept = mountChip({ pending: true, version: '1.0.0', restorable: false })
    await openChip(notKept)
    expect(inPanel('pending-deploy-diff')).toBeNull()
    expect(inPanel('pending-deploy-discard')).toBeNull()
    expect(inPanel('pending-deploy-generate')).toBeTruthy()
    notKept.unmount()
  })

  it('asks before discarding and emits only after the confirmation', async () => {
    const wrapper = mountChip({ pending: true, version: '1.0.0', restorable: true })
    await openChip(wrapper)

    inPanel('pending-deploy-discard').click()
    await settle()
    expect(wrapper.emitted('discard')).toBeUndefined()

    inPanel('pending-deploy-discard-cancel').click()
    await settle()
    expect(inPanel('pending-deploy-discard')).toBeTruthy()

    inPanel('pending-deploy-discard').click()
    await settle()
    inPanel('pending-deploy-discard-confirm').click()
    await settle()
    expect(wrapper.emitted('discard')).toHaveLength(1)
    wrapper.unmount()
  })

  it('asks the page for the differences and for the generation', async () => {
    const wrapper = mountChip({ pending: true, version: '1.0.0', restorable: true })
    await openChip(wrapper)
    inPanel('pending-deploy-diff').click()
    await settle()
    expect(wrapper.emitted('diff')).toHaveLength(1)

    await openChip(wrapper)
    inPanel('pending-deploy-generate').click()
    await settle()
    expect(wrapper.emitted('generate')).toHaveLength(1)
    wrapper.unmount()
  })
})

describe('SpecDiffDialog', () => {
  afterEach(() => { document.body.innerHTML = '' })

  const mountDialog = (props) => mount(SpecDiffDialog, {
    attachTo: document.body,
    props: { visible: true, version: '1.0.0', ...props },
    global: { plugins: mountGlobalPlugins() },
  })

  it('lists what was added and removed', async () => {
    mountDialog({
      deployed: { basicData: { name: 'P' }, features: ['A'] },
      saved: { basicData: { name: 'P' }, features: ['A', 'B'] },
    })
    await settle()
    expect(document.body.textContent).toContain('B')
    expect(document.body.querySelector('.spec-diff__row--added')).toBeTruthy()
  })

  const several = {
    deployed: { basicData: { name: 'P', version: '1.0.0' }, features: ['A'] },
    saved: { basicData: { name: 'Q', version: '1.0.0' }, features: ['A', 'B'] },
    models: {
      deployed: { basic: 'basic P\n', datamodel: 'datamodel\n' },
      saved: { basic: 'basic Q\n', datamodel: 'datamodel\n\nentity X {}\n', forms: 'forms\n' },
    },
  }

  it('has a view for each thing that changed and moves between them', async () => {
    const wrapper = mountDialog(several)
    await settle()

    const tabs = [...document.body.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('name'))
    expect(tabs).toEqual([
      'spec-diff-tab-features', 'spec-diff-tab-fields', 'spec-diff-tab-model:basic',
      'spec-diff-tab-model:datamodel', 'spec-diff-tab-model:forms',
    ])
    expect(document.body.querySelector('[name="spec-diff-view-features"]')).toBeTruthy()

    document.body.querySelector('[name="spec-diff-tab-model:datamodel"]').click()
    await settle()
    expect(document.body.querySelector('[name="spec-diff-view-model:datamodel"]')).toBeTruthy()
    expect(document.body.textContent).toContain('entity X {}')
    wrapper.unmount()
  })

  it('puts back only the view that is open, after asking', async () => {
    const wrapper = mountDialog(several)
    await settle()

    document.body.querySelector('[name="spec-diff-tab-model:datamodel"]').click()
    await settle()
    document.body.querySelector('[name="spec-diff-discard"]').click()
    await settle()
    expect(wrapper.emitted('discard')).toBeUndefined()

    document.body.querySelector('[name="spec-diff-discard-confirm"]').click()
    await settle()
    expect(wrapper.emitted('discard')).toEqual([[['model:datamodel']]])
    wrapper.unmount()
  })

  it('offers nothing to go back to for a model that was added since', async () => {
    const wrapper = mountDialog(several)
    await settle()

    document.body.querySelector('[name="spec-diff-tab-model:forms"]').click()
    await settle()
    expect(document.body.querySelector('[name="spec-diff-discard"]')).toBeNull()
    wrapper.unmount()
  })

  it('does not count the version among the changes', async () => {
    const wrapper = mountDialog({
      deployed: { basicData: { name: 'P', version: '1.0.0' }, features: ['A'] },
      saved: { basicData: { name: 'P', version: '1.1.0' }, features: ['A'] },
    })
    await settle()
    expect(document.body.querySelector('[name="spec-diff-none"]')).toBeTruthy()
    wrapper.unmount()
  })

  it('puts everything back from the footer', async () => {
    const wrapper = mountDialog(several)
    await settle()

    document.body.querySelector('[name="spec-diff-discard-all"]').click()
    await settle()
    expect(wrapper.emitted('discard')).toEqual([[[]]])
    wrapper.unmount()
  })

  it('is only to look at when it is read-only, and says what is compared with what', async () => {
    const wrapper = mountDialog({ ...several, readonly: true, title: 'Cambios de la versión 0.2.0', fromLabel: 'v0.1.0', toLabel: 'v0.2.0' })
    await settle()

    expect(document.body.querySelector('[name="spec-diff-discard"]')).toBeNull()
    expect(document.body.querySelector('[name="spec-diff-discard-all"]')).toBeNull()
    expect(document.body.textContent).toContain('Cambios de la versión 0.2.0')
    expect(document.body.textContent).toContain('v0.1.0')
    expect(document.body.textContent).toContain('v0.2.0')
    wrapper.unmount()
  })

  it('explains when the last generation did not keep its spec', async () => {
    mountDialog({ deployed: null, saved: { basicData: { name: 'P' } } })
    await settle()
    expect(document.body.querySelector('[name="spec-diff-no-snapshot"]')).toBeTruthy()
  })
})
