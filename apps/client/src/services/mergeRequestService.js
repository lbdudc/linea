import { api } from '../boot/axios'

/**
 * The merge requests of the repository of a line or of a product (`kind`: 'line' | 'product'), the same on every git host. A list is a
 * page: `{ items, page, perPage, hasMore }`; each merge request says how it was opened (`origin`: manual, sync or generation).
 */
const base = (kind, id) => `/${kind === 'line' ? 'lines' : 'products'}/${id}/mrs`

export default {
  /** The host, what it can do (`capabilities.mergeRequests`), the labels and the branches to choose from. */
  async meta({ kind, id }) {
    return (await api.get(`${base(kind, id)}/meta`)).data
  },

  async list({ kind, id, filter = {} }) {
    const { labels, ...rest } = filter
    const params = Object.fromEntries(Object.entries({ ...rest, labels: labels?.length ? labels.join(',') : undefined }).filter(([, value]) => value !== undefined && value !== '' && value !== 'all'))
    return (await api.get(base(kind, id), { params })).data
  },

  /** One merge request with its checks (`pipeline`, `jobs`). */
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

  /** The files it changes: `{ oldPath, newPath, status, additions, deletions, patch }`. */
  async diff({ kind, id, number }) {
    return (await api.get(`${base(kind, id)}/${number}/diff`)).data
  },

  /** Every conversation: the general messages and the ones about a line of the code (`position`). */
  async threads({ kind, id, number }) {
    return (await api.get(`${base(kind, id)}/${number}/threads`)).data
  },

  /** A message of its own, one about a line (`position: { path, line, side }`) or an answer (`threadId`). Answers with the thread. */
  async comment({ kind, id, number, body, position, threadId }) {
    return (await api.post(`${base(kind, id)}/${number}/threads`, { body, position, threadId })).data
  },

  async resolve({ kind, id, number, threadId, resolved }) {
    return (await api.put(`${base(kind, id)}/${number}/threads/${threadId}/resolved`, { resolved })).data
  },

  /** `{ merged: true }`; a merge that cannot be done answers 409 `{ merged: false, conflicts: true }`. */
  async merge({ kind, id, number, squash = false, deleteSourceBranch = false, message }) {
    return (await api.post(`${base(kind, id)}/${number}/merge`, { squash, deleteSourceBranch, message })).data
  },

  async approve({ kind, id, number }) {
    return (await api.post(`${base(kind, id)}/${number}/approve`)).data
  },

  async saveTemplate({ kind, id, name, content }) {
    return (await api.put(`${base(kind, id)}/templates/${encodeURIComponent(name)}`, { content })).data
  },

  async deleteTemplate({ kind, id, name }) {
    await api.delete(`${base(kind, id)}/templates/${encodeURIComponent(name)}`)
  },
}
