import { api } from '../boot/axios'

/** The settings of the deployment itself (an administrator): which git hosts are on and how each is set. */
export default {
  async gitHosts() {
    return (await api.get('/settings/git-hosts')).data
  },

  /** The people who can sign in here. */
  async users() {
    return (await api.get('/users')).data
  },

  /** A new account on this server's own git host. */
  async createUser({ username, password, admin }) {
    return (await api.post('/users', { username, password, admin })).data
  },

  async setPassword(id, password) {
    await api.put(`/users/${id}/password`, { password })
  },

  /** Makes a person an administrator, or takes it away. */
  async setAdmin(id, admin) {
    return (await api.put(`/users/${id}/admin`, { admin })).data
  },

  /** Switches an account off or on. */
  async setDisabled(id, disabled) {
    return (await api.put(`/users/${id}/disabled`, { disabled })).data
  },

  /** Removes a person; what they own goes to `transferTo` (a username) or is left to the administrators. */
  async deleteUser(id, transferTo) {
    await api.delete(`/users/${id}`, { params: transferTo ? { transferTo } : {} })
  },

  /** A person's own password. */
  async changeOwnPassword({ currentPassword, newPassword }) {
    await api.put('/users/me/password', { currentPassword, newPassword })
  },

  /** A new git token for the person's local account; the answer is the only time it is shown. */
  async regenerateGitToken() {
    return (await api.post('/users/me/git-token')).data.token
  },

  /** `{ enabled?, settings? }`: what changed about a host. */
  async saveGitHost(host, change) {
    return (await api.put(`/settings/git-hosts/${host}`, change)).data
  },

  /** Which host is the primary one (the owner of whatever names none). */
  async setPrimaryHost(host) {
    return (await api.put('/settings/git-hosts/primary', { host })).data
  },

  /** How this LINEA behaves (sign-in, modules, audit): `{ schema, values, meta }`. */
  async instance() {
    return (await api.get('/settings/instance')).data
  },

  /** Saves a change of those settings (`null` takes one back to its default); answers the whole of them. */
  async saveInstance(patch) {
    return (await api.put('/settings/instance', patch)).data
  },

  /** Who changed what, newest first: `{ limit, before, action }`. */
  async audit(params = {}) {
    return (await api.get('/settings/audit', { params })).data
  },

  /** An administrator ends every sign-in of a person. */
  async signOutEverywhere(id) {
    await api.delete(`/users/${id}/sessions`)
  },

  /** A linea.config.yml to bring in: `apply: false` answers what would change, `true` makes the changes. */
  async importConfig(text, apply = false) {
    return (await api.post('/settings/import', { text, apply })).data
  },
}
