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

  async serviceLogs(id, tail = 200, service = null, { logs = true } = {}) {
    return (await api.get(`/plugins/${id}/service/logs`, { params: { tail, service: service || undefined, logs: logs ? undefined : 0 } })).data
  },

  /**
   * The logs as they come (server-sent events). Resolves when the stream ends, rejects when it cannot be had; `signal` stops it.
   * `fetch`, not EventSource: the request carries the session's token.
   */
  async followServiceLogs(id, { tail = 200, service = null, signal, onData }) {
    const params = new URLSearchParams({ tail: String(tail) })
    if (service) params.set('service', service)
    const response = await fetch(`${process.env.API_URL || ''}/api/plugins/${id}/service/logs/stream?${params}`, {
      headers: { Authorization: `Bearer ${localStorage.token}` },
      signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const data = event.split('\n').find((line) => line.startsWith('data: '))
        if (!data) continue // a keep-alive comment
        const value = JSON.parse(data.slice(6))
        if (event.startsWith('event: failure')) throw new Error(value)
        onData(value)
      }
    }
  },

  async startService(id) {
    return (await api.post(`/plugins/${id}/service/start`)).data
  },

  async restartService(id) {
    return (await api.post(`/plugins/${id}/service/restart`)).data
  },

  async rebuildService(id) {
    return (await api.post(`/plugins/${id}/service/rebuild`)).data
  },

  async downService(id) {
    return (await api.post(`/plugins/${id}/service/down`)).data
  },

  /** `action`: start, stop or restart, of one container (a service of the plugin's compose file). */
  async containerAction(id, service, action) {
    return (await api.post(`/plugins/${id}/service/containers/${encodeURIComponent(service)}/${action}`)).data
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
