import { describe, it, expect, beforeEach } from 'vitest'
import { createI18n } from 'vue-i18n'
import { createUi, contributions, resetContributions } from 'src/plugins/registry'

const make = () => {
  const added = []
  const router = { addRoute: (route) => added.push(route), hasRoute: (name) => added.some((route) => route.name === name || route.children?.some((child) => child.name === name)) }
  const i18n = createI18n({ legacy: true, locale: 'en', messages: { en: { labels: { save: 'Save', never: 'Never' }, base: { x: 'x' } } } })
  return { ui: createUi({ plugin: 'p', router, i18n, layout: () => null, api: {} }), added, i18n }
}

beforeEach(resetContributions)

describe('the tabs a plugin adds to a line', () => {
  it('keeps the label, and `when` sees the line so a tab can be for some kinds only', async () => {
    const { slotItems } = await import('src/plugins/registry')
    const { pluginTabKey } = await import('src/plugins/lineTabs')
    const { ui } = make()
    ui.addSlot('line.tabs', { render: () => null }, { id: 'code', label: { en: 'Code', es: 'Código' }, order: 5, when: ({ kind }) => kind === 'plain' })

    expect(slotItems('line.tabs', { kind: 'modular' })).toEqual([])
    const [tab] = slotItems('line.tabs', { kind: 'plain' })
    expect(tab.label).toEqual({ en: 'Code', es: 'Código' })
    expect(pluginTabKey(tab)).toBe('plugin-code')
  })
})

describe('what a plugin adds to the interface', () => {
  it('pages with a frame of their own go in the app\'s layout, the frame around them', () => {
    const { ui, added } = make()
    const shell = () => null
    const page = () => null

    ui.addPages({ path: '/agents', shell, children: [{ path: '', name: 'flujo', component: page }, { path: 'salud', name: 'salud', component: page }] })

    expect(added).toHaveLength(1)
    expect(added[0].path).toBe('/agents')
    expect(added[0].meta).toMatchObject({ requiresAuth: true, plugin: 'p' })
    expect(added[0].children).toHaveLength(1)
    expect(added[0].children[0]).toMatchObject({ path: '', component: shell })
    expect(added[0].children[0].children.map((c) => c.name)).toEqual(['flujo', 'salud'])
  })

  it('its words join the app\'s; with keepExisting what the app says stays', () => {
    const { ui, i18n } = make()

    ui.addI18n({ en: { labels: { save: 'Persist', fresh: 'New' }, plugin: { y: 'y' } } }, { keepExisting: true })

    const messages = i18n.global.getLocaleMessage('en')
    expect(messages.labels).toEqual({ save: 'Save', never: 'Never', fresh: 'New' })
    expect(messages.plugin).toEqual({ y: 'y' })
    expect(messages.base).toEqual({ x: 'x' })
  })

  it('without keepExisting a plugin can reword (the GitHub words do)', () => {
    const { ui, i18n } = make()
    ui.addI18n({ en: { labels: { save: 'Persist' } } })
    expect(i18n.global.getLocaleMessage('en').labels.save).toBe('Persist')
  })

  it('a nav entry can be a page of the app or a link out, and is active for the paths it says', () => {
    const { ui } = make()
    ui.addNav({ id: 'a', icon: 'pi-x', label: 'A', to: '/agents', activeFor: ['/agents'] })
    ui.addNav({ id: 'b', icon: 'pi-y', label: 'B', href: 'https://example.org' })
    ui.addNav({ id: 'a', icon: 'pi-x', label: 'A2', to: '/agents' })

    expect(contributions.nav.map((n) => [n.id, n.label])).toEqual([['a', 'A2'], ['b', 'B']])
  })
})

describe('names and words that outlive the registration', () => {
  it('a route name another page already has is refused, not taken', () => {
    const { ui } = make()
    ui.addRoute({ path: '/a', name: 'dup', component: () => null })
    expect(() => ui.addRoute({ path: '/b', name: 'dup', component: () => null })).toThrow(/already taken/)
  })

  it('the text of a plugin keeps the host\'s words, and survives a switch of profile', async () => {
    const { setProfileWords } = await import('src/boot/hostWords')
    const { ui, i18n } = make()
    i18n.global.setLocaleMessage('en', { labels: { save: 'Save' } })
    setProfileWords({ i18n, kind: 'github' })
    ui.addI18n({ en: { plugin: { mr: 'Open the merge request on GitLab' } } })
    expect(i18n.global.t('plugin.mr')).toBe('Open the pull request on GitHub')

    setProfileWords({ i18n, kind: 'local' })
    expect(i18n.global.t('plugin.mr')).toBe('Open the change request on LINEA')
    setProfileWords({ i18n, kind: 'gitlab' })
    expect(i18n.global.t('plugin.mr')).toBe('Open the merge request on GitLab')
  })
})
