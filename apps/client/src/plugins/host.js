import { api } from '../boot/axios'
import { createUi, resetContributions } from './registry'
import pluginModules from 'virtual:linea-plugins'

// The client code of every plugin of PLUGINS_DIR (the `linea-plugins` checkout next to this one by default), through the virtual module of plugin-deps.mjs; it is built into the app, but only what the server
// says is enabled gets to `register`.
const available = pluginModules

let loaded = false
let known = null // the ids and versions the page registered, to see whether the server's list changed

const fingerprint = (enabled) => enabled.map(({ id, version }) => `${id}@${version}`).sort().join(',')

/** Asks the server which plugins are enabled and lets each one register what it adds. Once per page load. */
export const loadPlugins = async ({ router, i18n, layout }) => {
  if (loaded) return false
  let enabled = []
  try {
    enabled = (await api.get('/plugins/enabled')).data
  } catch {
    return false // a server without plugins, or no session yet: the app is the base (asked again at the next navigation)
  }
  loaded = true
  known = fingerprint(enabled)
  resetContributions()
  let changed = false
  for (const info of enabled) {
    const { id } = info
    const load = available[id]
    if (!load) continue // a plugin with no client code (a remote service, say)
    try {
      const module = await load()
      await (module.default ?? module).register(createUi({ plugin: id, router, i18n, layout, api, info }))
      changed = true
    } catch (error) {
      console.error(`[plugins] ${id} failed to register:`, error)
    }
  }
  return changed
}

/**
 * Loads the plugins before the first page of a session is drawn. A route a plugin adds is not known until then, so the navigation that
 * triggered the load is started again.
 */
export const installPluginGuard = ({ router, i18n }) => {
  const layout = () => import('layouts/DashboardLayout.vue')
  router.beforeEach(async (to) => {
    if (loaded) return true
    if (await loadPlugins({ router, i18n, layout })) return { path: to.path, query: to.query, hash: to.hash, replace: true }
    return true
  })
}

/** After enabling or disabling a plugin the page is loaded again: what a plugin added to the interface goes with it. */
export const reloadForPlugins = () => window.location.reload()


/**
 * Another administrator (or another tab) switched a plugin on or off: this page still shows the menus and routes of the old set.
 * Reloads when the server's list is not the one this page registered (the tab that made the change reloads by itself).
 */
export const checkPluginsChanged = async () => {
  if (!loaded) return false
  try {
    const enabled = (await api.get('/plugins/enabled')).data
    if (fingerprint(enabled) === known) return false
  } catch {
    return false
  }
  reloadForPlugins()
  return true
}
