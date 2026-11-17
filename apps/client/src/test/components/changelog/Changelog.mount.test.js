import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import ChangelogPanel from 'components/changelog/ChangelogPanel.vue'
import ChangelogView from 'components/changelog/ChangelogView.vue'
import SyncPreviewDialog from 'components/changelog/SyncPreviewDialog.vue'

const getChangelog = vi.fn()
vi.mock('src/services/productService', () => ({ default: { getChangelog: (...a) => getChangelog(...a) } }))

const entry = (description, extra = {}) => ({ shortId: 'abc1234', webUrl: 'https://git.example/c/abc1234', description, scope: null, references: [{ kind: 'issue', number: 7, webUrl: 'https://git.example/i/7' }], ...extra })
const changelog = {
  breaking: true,
  sections: [
    { id: 'breaking', entries: [entry('drops the old API', { version: '1.2.0' })] },
    { id: 'features', entries: [entry('adds search', { version: '1.1.0', webUrl: 'javascript:alert(1)' })] },
  ],
  dependencies: [{ location: 'gitlab:g/a', name: 'a', kind: 'module', change: 'upgraded', from: '1.0.0', to: '1.1.0', changelog: { breaking: true, sections: [{ id: 'fixes', entries: [entry('fixes a bug')] }] } }],
}
const global = () => ({ plugins: mountGlobalPlugins() })
afterEach(() => { document.body.innerHTML = ''; getChangelog.mockReset() })

describe('ChangelogView', () => {
  it('shows the sections, links to the commits and issues, and warns of incompatible changes', () => {
    const wrapper = mount(ChangelogView, { props: { changelog }, global: global() })
    expect(wrapper.find('[data-test="changelog-breaking"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="changelog-section-breaking"]').text()).toContain('drops the old API')
    expect(wrapper.find('a[href="https://git.example/i/7"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="changelog-dependencies-module"]').text()).toContain('fixes a bug')
  })

  it('groups what each version brought, the oldest first', () => {
    const wrapper = mount(ChangelogView, { props: { changelog }, global: global() })
    const titles = wrapper.findAll('.changelog__version-title').map((t) => t.text())
    expect(titles).toEqual(['v1.1.0', 'v1.2.0'])
    expect(wrapper.find('[data-test="changelog-version-1.1.0"]').text()).toContain('adds search')
    expect(wrapper.find('[data-test="changelog-version-1.2.0"]').text()).toContain('drops the old API')
  })

  it('has no heading when there is a single version', () => {
    const one = { sections: [{ id: 'fixes', entries: [entry('only fix', { version: '1.0.0' })] }] }
    expect(mount(ChangelogView, { props: { changelog: one }, global: global() }).find('.changelog__version-title').exists()).toBe(false)
  })

  it('puts the commit id of each change as a link to the commit on the host', () => {
    const wrapper = mount(ChangelogView, { props: { changelog }, global: global() })
    const link = wrapper.find('[data-test="changelog-section-breaking"] a[data-test="commit-link"]')
    expect(link.text()).toBe('abc1234')
    expect(link.attributes('href')).toBe('https://git.example/c/abc1234')
    // a host that gave no address still shows the id, without a link
    const plain = mount(ChangelogView, { props: { changelog: { sections: [{ id: 'fixes', entries: [entry('x', { webUrl: '' })] }] } }, global: global() })
    expect(plain.find('a[data-test="commit-link"]').exists()).toBe(false)
    expect(plain.text()).toContain('abc1234')
  })

  it('keeps metamodels and modules apart', () => {
    const dep = (name, kind) => ({ location: `gitlab:g/${name}`, name, kind, change: 'upgraded', from: '1.0.0', to: '1.1.0', changelog: { sections: [] } })
    const wrapper = mount(ChangelogView, { props: { changelog: { sections: [], dependencies: [dep('m1', 'module'), dep('mm1', 'metamodel')] } }, global: global() })
    const blocks = wrapper.findAll('[data-test^="changelog-dependencies-"]')
    expect(blocks.map((b) => b.attributes('data-test'))).toEqual(['changelog-dependencies-metamodel', 'changelog-dependencies-module'])
    expect(blocks[0].text()).toContain('mm1')
    expect(blocks[1].text()).toContain('m1')
  })

  it('does not link an address that is not a web one', () => {
    const wrapper = mount(ChangelogView, { props: { changelog }, global: global() })
    expect(wrapper.html()).not.toContain('javascript:')
  })

  it('says so when there is nothing', () => {
    const wrapper = mount(ChangelogView, { props: { changelog: { sections: [], dependencies: [] } }, global: global() })
    expect(wrapper.find('[data-test="changelog-empty"]').exists()).toBe(true)
  })
})

describe('ChangelogPanel', () => {
  it('reads the changelog only when it is opened', async () => {
    const load = vi.fn().mockResolvedValue(changelog)
    const wrapper = mount(ChangelogPanel, { props: { load }, global: global() })
    expect(load).not.toHaveBeenCalled()
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(load).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-test="changelog"]').exists()).toBe(true)
  })

  it('tells the loaded changelog to its parent, and says when it could not be read', async () => {
    const wrapper = mount(ChangelogPanel, { props: { load: vi.fn().mockResolvedValue(changelog), open: true }, global: global() })
    await flushPromises()
    expect(wrapper.emitted('loaded')[0][0].breaking).toBe(true)
    const failing = mount(ChangelogPanel, { props: { load: vi.fn().mockRejectedValue(new Error('x')), open: true }, global: global() })
    await flushPromises()
    expect(failing.find('[data-test="changelog-failed"]').exists()).toBe(true)
  })
})

describe('SyncPreviewDialog', () => {
  const mountDialog = () => mount(SyncPreviewDialog, { props: { visible: true, productId: 'p1', productName: 'Shop' }, global: { ...global(), stubs: { transition: false } }, attachTo: document.body })

  it('shows what the dependencies bring and confirms the sync', async () => {
    getChangelog.mockResolvedValue({ dependencies: changelog.dependencies })
    const wrapper = mountDialog()
    await flushPromises()
    expect(document.body.textContent).toContain('fixes a bug')
    document.body.querySelector('[name="confirm-sync"]').click()
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('says nothing changed, and still lets the sync go on when the preview fails', async () => {
    getChangelog.mockResolvedValue({ dependencies: [] })
    mountDialog()
    await flushPromises()
    expect(document.body.querySelector('[data-test="sync-preview-nothing"]')).not.toBeNull()
    getChangelog.mockRejectedValue(new Error('x'))
    document.body.innerHTML = ''
    const wrapper = mountDialog()
    await flushPromises()
    expect(document.body.querySelector('[data-test="sync-preview-failed"]')).not.toBeNull()
    document.body.querySelector('[name="confirm-sync"]').click()
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })
})
