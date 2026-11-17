import { reactive } from 'vue'
import userService from 'src/services/userService'

// The git hosts people can sign in with here, as the server lists them (`GET /users/config`): read once, it does not change while the page is open.
const gitHosts = reactive({ loaded: false, hosts: [], primary: null })

let loading = null

/** Forgets what was read, for the next `loadGitHosts` to ask again (an administrator changed the hosts). */
export const resetGitHosts = () => {
  loading = null
  userService.forgetConfig()
}

export const loadGitHosts = () => {
  loading ??= Promise.resolve(userService.getConfig())
    .then((config) => {
      gitHosts.hosts = Array.isArray(config?.hosts) ? config.hosts : []
      gitHosts.primary = config?.primary ?? null
    })
    .catch(() => { loading = null })
    .finally(() => { gitHosts.loaded = true })
  return loading
}

/** Whether the host runs a pipeline for what is pushed to it (the repositories on LINEA's own server run none). */
export const hostRunsPipelines = (id) => gitHosts.hosts.find((host) => host.id === id)?.terms?.pipelines !== false

export const hostById = (id) => gitHosts.hosts.find((host) => host.id === id)

export { gitHosts }
