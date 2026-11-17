import { reactive } from 'vue'

const runStore = reactive({
  runs: [],

  begin({ id, name, lineName = '', kind = 'sync' }) {
    const run = { id: `${String(id)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, productId: String(id), productName: name, lineName, kind }
    this.runs.push(run)
    return () => {
      const index = this.runs.findIndex((item) => item.id === run.id)
      if (index !== -1) this.runs.splice(index, 1)
    }
  },
})

export default runStore
