import { api } from '../boot/axios'

export default {
  /**
   * What the scheduler of syncs is doing: running, queued, coming in the next day. `lineId` / `productId` limit it to one SPL or one
   * product; without them, everything the person may see.
   */
  async status({ lineId, productId } = {}) {
    return (await api.get('/scheduler', { params: { ...(lineId ? { lineId } : {}), ...(productId ? { productId } : {}) } })).data
  },
}
