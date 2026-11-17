import { api } from '../boot/axios'

export default {
  /**
   * The generations and syncs of what the person may see, together: counts, runs per day and the latest runs.
   * `lineId` / `productId` limit it to one SPL or one product; `kind` is `generation` or `sync`.
   */
  async overview({ lineId, productId, days, kind } = {}) {
    const tz = new Date().getTimezoneOffset()
    const params = { tz, ...(lineId ? { lineId } : {}), ...(productId ? { productId } : {}), ...(days ? { days } : {}), ...(kind ? { kind } : {}) }
    return (await api.get('/cicd', { params })).data
  },
}
