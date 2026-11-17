import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import GeneratePreviewDialog from 'components/generation/GeneratePreviewDialog.vue'

const { service } = vi.hoisted(() => ({
  service: {
    getProductsDeployments: vi.fn(),
    getProductsStatus: vi.fn(),
    getDeployment: vi.fn(),
    getProductHealth: vi.fn(),
    previewGeneration: vi.fn(),
  },
}))
vi.mock('src/services/productService', () => ({ default: service }))

const settle = () => new Promise((resolve) => setTimeout(resolve, 60))
const q = (selector) => document.body.querySelector(selector)

const PRODUCTS = [
  { id: 'a', name: 'Alpha', version: '1.2.3' },
  { id: 'b', name: 'Beta', version: '0.4.0' },
  { id: 'c', name: 'Gamma', version: '2.0.0' },
]

const spec = (features) => ({ basicData: { name: 'P', version: '1.0.0' }, features })

beforeEach(() => {
  for (const fn of Object.values(service)) fn.mockReset()
  service.getProductsDeployments.mockResolvedValue({
    a: { pending: true, version: '1.2.3' }, b: { pending: false, version: '0.4.0' }, c: { pending: null },
  })
  service.getProductsStatus.mockResolvedValue({
    a: { health: { valid: true } }, b: { health: { valid: false, error: 'feature X not found' } }, c: { health: { valid: true } },
  })
  service.getDeployment.mockImplementation(async ({ id }) => ({
    saved: spec(id === 'a' ? ['A', 'B'] : ['A']),
    deployed: id === 'c' ? null : spec(['A']),
    models: null,
    version: id === 'c' ? null : '1.0.0',
  }))
  service.getProductHealth.mockResolvedValue({ valid: true })
})

afterEach(() => { document.body.innerHTML = '' })

function mountDialog(props = {}) {
  return mount(GeneratePreviewDialog, {
    attachTo: document.body,
    props: { visible: true, products: PRODUCTS, ...props },
    global: { plugins: mountGlobalPlugins() },
  })
}

describe('GeneratePreviewDialog — what happens if the checks do not pass', () => {
  it('is not asked here', async () => {
    const wrapper = mountDialog({ products: [PRODUCTS[0]] })
    await settle()
    expect(q('[name="gp-detail-a"]').textContent).not.toContain('checks')
    expect(document.body.querySelector('[role="radio"][name^="cicd-on-failed"]')).toBeFalsy()
    q('[name="product-generate-confirm"]').click()
    await settle()
    expect(wrapper.emitted('confirm')[0][0][0]).not.toHaveProperty('onChecksFailed')
  })
})

describe('GeneratePreviewDialog — one product', () => {
  it('shows the version it would get and what is saved, and emits the part chosen', async () => {
    const wrapper = mountDialog({ products: [PRODUCTS[0]] })
    await settle()

    expect(q('[name="gp-detail-a"]')).toBeTruthy()
    expect(q('[name="gp-detail-a"]').textContent).toContain('v1.2.4')
    expect(q('.spec-diff__row--added')).toBeTruthy()

    q('[name="bump-minor"]').click()
    await settle()
    expect(q('[name="gp-detail-a"]').textContent).toContain('v1.3.0')

    q('[name="product-generate-confirm"]').click()
    await settle()
    expect(wrapper.emitted('confirm')).toEqual([[[{ id: 'a', name: 'Alpha', bump: 'minor' }]]])
    expect(wrapper.emitted('update:visible').at(-1)).toEqual([false])
  })

  it('lists what is wrong with it and turns the confirmation into "anyway"', async () => {
    const wrapper = mountDialog({ products: [PRODUCTS[1]], knownIssues: ['feature X not found'] })
    await settle()

    expect(q('[name="generate-issues"]').textContent).toContain('feature X not found')
    expect(q('[name="product-generate-confirm"]').textContent.toLowerCase()).toMatch(/todos modos|anyway|igualmente/)
    wrapper.unmount()
  })

  it('works out the files that change by itself when something was generated before', async () => {
    service.previewGeneration.mockResolvedValue({
      version: '1.2.4', previousVersion: '1.2.3', changed: true,
      counts: { create: 1, update: 2, delete: 0 },
      files: [
        { path: 'server/a.java', action: 'create', added: 3, removed: 0, diff: '@@ -0,0 +1,3 @@\n+one\n+two\n+three' },
        { path: 'client/b.js', action: 'update', added: 1, removed: 1, diff: '@@ -1,1 +1,1 @@\n-old\n+new' },
        { path: 'client/c.js', action: 'update', added: 0, removed: 0, diff: null },
      ],
      truncated: false,
    })
    const wrapper = mountDialog({ products: [PRODUCTS[0]] })
    await settle()
    expect(service.previewGeneration).toHaveBeenCalledTimes(1)
    expect(service.previewGeneration).toHaveBeenCalledWith({ id: 'a', bump: 'minor' })
    expect(q('[name="gp-code"]').textContent).toContain('a.java')
    expect(q('[name="cf-dir-server"]')).toBeTruthy()
    expect(q('[name="cf-file-client/b.js"]').className).toContain('cf__row--update')
    expect(q('[name="cf-diff-client/b.js"]')).toBeNull()

    q('[name="cf-file-client/b.js"]').click()
    await settle()
    expect(q('[name="cf-diff-client/b.js"]').textContent).toContain('+new')
    expect(q('[name="cf-diff-client/b.js"] .cf__line--del').textContent).toContain('-old')

    q('[name="cf-file-client/c.js"]').click()
    await settle()
    expect(q('[name="cf-diff-client/c.js"]').textContent.length).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('does not work out the files of a first generation until asked', async () => {
    const wrapper = mountDialog({ products: [PRODUCTS[2]] })
    await settle()
    expect(service.previewGeneration).not.toHaveBeenCalled()
    expect(q('[name="gp-code-calc"]')).toBeTruthy()
    wrapper.unmount()
  })

  it('recommends the part to raise from what changed, and starts on it', async () => {
    const wrapper = mountDialog({ products: [PRODUCTS[0]] })
    await settle()
    expect(q('[name="gp-recommendation"]').textContent).toContain('1')
    expect(q('[name="bump-recommended-minor"]')).toBeTruthy()
    expect(q('[name="bump-recommended-patch"]')).toBeFalsy()
    expect(q('[name="bump-minor"]').getAttribute('aria-checked')).toBe('true')
    q('[name="bump-patch"]').click()
    await settle()
    expect(q('[name="bump-patch"]').getAttribute('aria-checked')).toBe('true')
    wrapper.unmount()
  })

  it('starts on the recommendation even when the page names patch as its default', async () => {
    const wrapper = mountDialog({ products: [{ ...PRODUCTS[0], bump: 'patch' }] })
    await settle()
    expect(q('[name="bump-minor"]').getAttribute('aria-checked')).toBe('true')
    wrapper.unmount()
  })

  it('leaves a part that the page asked for', async () => {
    const wrapper = mountDialog({ products: [{ ...PRODUCTS[0], bump: 'major' }] })
    await settle()
    expect(q('[name="bump-major"]').getAttribute('aria-checked')).toBe('true')
    wrapper.unmount()
  })

  it('says why the files could not be worked out', async () => {
    service.previewGeneration.mockRejectedValue({ response: { data: { error: 'error_messages.module_check_failed', detail: 'models/datamodel does not fit' } } })
    const wrapper = mountDialog({ products: [PRODUCTS[0]] })
    await settle()

    q('[name="gp-code-calc"]').click()
    await settle()

    expect(q('[name="gp-code-error"]').textContent).toContain('models/datamodel does not fit')
    wrapper.unmount()
  })
})

describe('GeneratePreviewDialog — several products', () => {
  it('lists them with their next version and what is wrong or pending, in one request each', async () => {
    const wrapper = mountDialog()
    await settle()

    expect(q('[name="gp-row-a"]').textContent).toContain('v1.3.0')
    expect(q('[name="gp-row-b"]').textContent).toContain('v0.4.1')
    expect(q('[name="gp-row-b"] .gp__tag--bad')).toBeTruthy()
    expect(q('[name="gp-row-a"] .gp__tag--warn')).toBeTruthy()
    expect(service.getProductsDeployments).toHaveBeenCalledTimes(1)
    expect(service.getProductsStatus).toHaveBeenCalledTimes(1)
    // only the one that is looked at is read in full
    expect(service.getDeployment).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('reads another product only when it is looked at', async () => {
    const wrapper = mountDialog()
    await settle()

    q('[name="gp-row-c"] .gp__row-main').click()
    await settle()

    expect(service.getDeployment).toHaveBeenCalledTimes(2)
    expect(q('[name="gp-first"]')).toBeTruthy()
    wrapper.unmount()
  })

  it('raises all of them by the same part, and a product by its own', async () => {
    const wrapper = mountDialog()
    await settle()

    // all: minor
    const minor = [...document.body.querySelectorAll('.gp__global .p-togglebutton')].find((el) => /menor|minor/i.test(el.textContent))
    minor.click()
    await settle()
    expect(q('[name="gp-row-a"]').textContent).toContain('v1.3.0')
    expect(q('[name="gp-row-b"]').textContent).toContain('v0.5.0')

    // b: its own, major
    q('[name="gp-row-b"] .gp__row-main').click()
    await settle()
    q('[name="gp-detail-b"] [name="bump-major"]').click()
    await settle()
    expect(q('[name="gp-row-b"]').textContent).toContain('v1.0.0')
    expect(q('[name="gp-row-a"]').textContent).toContain('v1.3.0')

    q('[name="product-generate-confirm"]').click()
    await settle()
    expect(wrapper.emitted('confirm')[0][0]).toEqual([
      { id: 'a', name: 'Alpha', bump: 'minor' },
      { id: 'b', name: 'Beta', bump: 'major' },
      { id: 'c', name: 'Gamma', bump: 'minor' },
    ])
  })

  it('leaves out the products that are unticked', async () => {
    const wrapper = mountDialog()
    await settle()

    // the PrimeVue checkbox is clicked on its box; what carries the name is the root
    q('[name="gp-include-b"]').click()
    await settle()
    q('[name="product-generate-confirm"]').click()
    await settle()

    expect(wrapper.emitted('confirm')[0][0].map((item) => item.id)).toEqual(['a', 'c'])
  })

  it('cannot confirm with nothing included', async () => {
    const wrapper = mountDialog()
    await settle()

    q('[name="gp-include-all"]').click()
    await settle()

    expect(q('[name="product-generate-confirm"]').disabled).toBe(true)
    wrapper.unmount()
  })
})
