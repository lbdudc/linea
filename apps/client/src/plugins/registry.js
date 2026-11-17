import { noteMessages } from '../boot/hostWords'
import { reactive, markRaw } from 'vue'

/**
 * What the enabled plugins contribute to the interface. The pages read it (nav, slots); a plugin fills it through the `ui`
 * object that `host.js` gives its `register(ui)`.
 */
export const contributions = reactive({
  nav: [], // { id, icon, label, to | href, activeFor, plugin } (`href` is a page outside LINEA, opened in its own tab)
  slots: {}, // name -> [{ id, component, when, order, label, plugin }] (`label` names a tab in `line.tabs`)
})

export const resetContributions = () => {
  contributions.nav.splice(0)
  for (const key of Object.keys(contributions.slots)) delete contributions.slots[key]
}

// `extra` added to `base`, deeply: what both say, `base` wins
const deepMerge = (extra, base) => {
  const out = { ...base }
  for (const [key, value] of Object.entries(extra ?? {})) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object'
      ? deepMerge(value, out[key])
      : (key in out ? out[key] : value)
  }
  return out
}

const upsert = (list, item) => {
  const at = list.findIndex((existing) => existing.id === item.id)
  if (at >= 0) list.splice(at, 1, item)
  else list.push(item)
}

/** The slots a page offers. One place to read them, so a typo in a plugin shows up in the tests. */
export const SLOTS = ['line.tabs', 'product.tabs', 'featureModel.strip', 'featureModel.actions', 'featureModel.panels', 'line.create.fields', 'dashboard.widgets']

export const slotItems = (name, context = {}) =>
  (contributions.slots[name] ?? [])
    .filter((item) => !item.when || item.when(context))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))

/** `label` is a string or `{ en, es, gl }`; the current language's, then English, then any. */
export const localized = (label, locale) =>
  typeof label === 'string' || !label ? (label ?? '') : (label[locale] ?? label.en ?? Object.values(label)[0] ?? '')

// the names of routes are global: a plugin that reuses one of the app's (or of another plugin's) would take its place without a word
const namesOf = (routes = []) => routes.flatMap((route) => [...(route.name ? [route.name] : []), ...namesOf(route.children)])
const assertFreeNames = (router, plugin, names) => {
  const taken = names.filter((name) => router.hasRoute(name))
  if (taken.length) throw new Error(`${plugin}: the route name(s) ${taken.join(', ')} are already taken`)
}

export const createUi = ({ plugin, router, i18n, layout, api, info = {} }) => ({
  plugin,

  /** The app's router (for a plugin whose pages navigate by themselves). */
  router,

  /** What the server says of this plugin: `{ id, version, client, web, settings }` (`web` is where its own interface is, when it has one). */
  info,

  /** The public settings of this plugin (those it marked `public` in its manifest), as the deployment configured them. */
  settings: info.settings ?? {},

  /** The app's axios instance (base `/api`, with the session): what a plugin asks its server routes and LINEA's with. */
  api,

  addNav: (item) => upsert(contributions.nav, { ...item, plugin }),

  /** A page for the plugin, in the app's layout. `path` is absolute, `component` a component or a function that imports it. */
  addRoute: ({ path, component, name, props }) => {
    const routeName = name ?? `${plugin}:${path}`
    assertFreeNames(router, plugin, [routeName])
    // the name is the page's own (a named parent with an empty-path child renders no page when navigated to by name)
    router.addRoute({
      path,
      component: layout,
      meta: { requiresAuth: true, plugin },
      children: [{ path: '', name: routeName, component: typeof component === 'function' ? component : markRaw(component), props }],
    })
  },

  /**
   * A set of pages with a frame of their own (a side bar, say), in the app's layout: `shell` is the frame (it renders a `<router-view>`),
   * `children` are `{ path, name, component }` relative to `path`.
   */
  addPages: ({ path, shell, children }) => {
    assertFreeNames(router, plugin, [`${plugin}:${path}`, ...namesOf(children)])
    router.addRoute({
      path,
      name: `${plugin}:${path}`,
      component: layout,
      meta: { requiresAuth: true, plugin },
      children: [{ path: '', component: typeof shell === 'function' ? shell : markRaw(shell), children }],
    })
  },

  /** Puts a component in a slot of a page (see `SLOTS`). It receives the slot's context as props; `when(context)` can hide it. */
  addSlot: (name, component, { id = `${plugin}:${name}`, when, order, label } = {}) => {
    contributions.slots[name] ??= []
    upsert(contributions.slots[name], { id, component: markRaw(component), when, order, label, plugin })
  },

  /** Merges messages into the app's. With `keepExisting` what the app already says wins on a clash (a plugin cannot reword the base). */
  addI18n: (messages, { keepExisting = false } = {}) => {
    for (const [locale, tree] of Object.entries(messages)) {
      if (!keepExisting) i18n.global.mergeLocaleMessage(locale, tree)
      else i18n.global.setLocaleMessage(locale, deepMerge(tree, i18n.global.getLocaleMessage(locale)))
      // (the host's words are put over it: a plugin registers after they were set, and the next switch must not lose its text)
      noteMessages({ i18n, locale, tree, keepExisting })
    }
  },
})
