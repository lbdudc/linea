import { api } from '../boot/axios'

/**
 * The issues of the repository of a line or of a product (`kind`: 'line' | 'product'), the same on every git host.
 * A list is a page: `{ items, page, perPage, hasMore }`.
 */
const base = (kind, id) => `/${kind === 'line' ? 'lines' : 'products'}/${id}/issues`

export default {
  /** The host, what it can do (`capabilities.issues`) and the labels and milestones to choose from. */
  async meta({ kind, id }) {
    return (await api.get(`${base(kind, id)}/meta`)).data
  },

  async list({ kind, id, filter = {} }) {
    const { labels, ...rest } = filter
    const params = Object.fromEntries(Object.entries({ ...rest, labels: labels?.length ? labels.join(',') : undefined }).filter(([, value]) => value !== undefined && value !== ''))
    return (await api.get(base(kind, id), { params })).data
  },

  async get({ kind, id, number }) {
    return (await api.get(`${base(kind, id)}/${number}`)).data
  },

  async create({ kind, id, ...fields }) {
    return (await api.post(base(kind, id), fields)).data
  },

  /** Only the fields given are changed; `state: 'closed' | 'opened'` closes and reopens. */
  async update({ kind, id, number, ...changes }) {
    return (await api.patch(`${base(kind, id)}/${number}`, changes)).data
  },

  async comments({ kind, id, number }) {
    return (await api.get(`${base(kind, id)}/${number}/comments`)).data
  },

  async addComment({ kind, id, number, body }) {
    return (await api.post(`${base(kind, id)}/${number}/comments`, { body })).data
  },

  async saveTemplate({ kind, id, name, content }) {
    return (await api.put(`${base(kind, id)}/templates/${encodeURIComponent(name)}`, { content })).data
  },

  async deleteTemplate({ kind, id, name }) {
    await api.delete(`${base(kind, id)}/templates/${encodeURIComponent(name)}`)
  },
}
