import { api } from '../boot/axios'

export default {
  async list({ unread = false, page = 1 } = {}) {
    return (await api.get('/notifications', { params: { unread: unread || undefined, page } })).data
  },

  async markRead(ids) {
    return (await api.post('/notifications/read', ids ? { ids } : {})).data
  },

  async remove(id) {
    return (await api.delete(`/notifications/${id}`)).data
  },
}
