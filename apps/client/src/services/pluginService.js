import { api } from '../boot/axios'

/** The plugin catalog and what is done with it (changing needs an admin). */
export default {
  async list() {
    return (await api.get('/plugins')).data
  },

  async install(id) {
    return (await api.post(`/plugins/${id}/install`)).data
  },

  async enable(id) {
    return (await api.post(`/plugins/${id}/enable`)).data
  },

  async disable(id) {
    return (await api.post(`/plugins/${id}/disable`)).data
  },

  async serviceLogs(id, tail = 200, service = null) {
    return (await api.get(`/plugins/${id}/service/logs`, { params: { tail, service: service || undefined } })).data
  },

  async startService(id) {
    return (await api.post(`/plugins/${id}/service/start`)).data
  },

  async stopService(id) {
    return (await api.post(`/plugins/${id}/service/stop`)).data
  },

  async getSettings(id) {
    return (await api.get(`/plugins/${id}/settings`)).data
  },

  async saveSettings(id, values) {
    return (await api.put(`/plugins/${id}/settings`, values)).data
  },

  /** The state of the plugins as a linea.config.yml (text). */
  async exportConfig() {
    return (await api.get('/plugins/config.yml', { responseType: 'text', transformResponse: (data) => data })).data
  },

  async uninstall(id) {
    return (await api.delete(`/plugins/${id}`)).data
  },
}
