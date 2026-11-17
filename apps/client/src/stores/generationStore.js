import { reactive } from 'vue'
import { socket } from 'src/boot/ws'
import productService from 'src/services/productService'
import { bumpVersion } from 'src/utils/bumpVersion'

const DEFAULT_CONCURRENCY = 3
const DEFAULT_ESTIMATE_MS = 15000
const REMEMBERED_RUNS = 10

// The queue of generations of this page: up to `concurrency` of them run at once (the instance setting of the same name, 3 until the server
// says otherwise), each product at most once at a time (the server holds a lock per product). Socket events carry the product they belong to.
const generationStore = reactive({
  jobs: [],         // GenerationJob[] — all jobs, newest first (display order)
  _queue: [],       // job.id[] — pending ids, processed FIFO
  _running: [],     // job.id[] — the jobs that have been sent to the server and have not answered
  _durations: [],   // how long the last generations took, in ms
  _configured: false,
  _listening: false,
  concurrency: DEFAULT_CONCURRENCY,

  // Enqueue an array of { _id, name, lineId, lineName, bump?, version?, deployable? } objects. Answers the ids of the jobs it made.
  enqueue(products) {
    const newJobs = products.map(p => ({
      id: `${String(p._id)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      productId: String(p._id),
      productName: p.name,
      lineId: String(p.lineId || ''),
      lineName: p.lineName || '',
      bump: p.bump || undefined,   // 'patch' | 'minor' | 'major': the part to raise, patch when not given
      fromVersion: p.version || '',
      toVersion: p.version ? bumpVersion(p.version, p.bump || 'patch') : '',
      deployable: p.deployable !== false,
      result: null,   // what the server answered: { changed, conflicts }
      status: 'pending',   // 'pending' | 'running' | 'success' | 'warning' | 'error' | 'cancelled'
      queue: null,         // while it waits: { position, waiting, running, estimateMs }
      cancelling: false,   // a cancel was asked of the server and it has not answered yet
      cancelRefused: false, // the server was already writing: too late to stop it
      messages: [],
      startedAt: null,
      finishedAt: null,
      _notified: false,
    }))
    this.jobs.unshift(...newJobs)
    this._queue.push(...newJobs.map(j => j.id))
    this._pump()
    this._configure()
    return newJobs.map(j => j.id)
  },

  // A job that has not started leaves the queue; one that is running is asked to stop, and it does if it has not started writing.
  cancel(jobId) {
    const job = this.jobs.find(j => j.id === jobId)
    if (!job) return false
    if (job.status === 'pending') {
      this._queue = this._queue.filter(id => id !== jobId)
      job.status = 'cancelled'
      job.finishedAt = new Date()
      this._syncQueue()
      return true
    }
    if (job.status === 'running' && !job.cancelling) {
      job.cancelling = true
      job.cancelRefused = false
      productService.cancelGeneration({ id: job.productId })
        .then((answer) => {
          if (answer?.status !== 'cancelling') {
            job.cancelling = false
            job.cancelRefused = answer?.status === 'committing'
          }
        })
        .catch(() => { job.cancelling = false })
      return true
    }
    return false
  },

  // Where a waiting job stands: its place in the queue and about when it would be over, from how long the last ones took.
  queueInfo(jobId) {
    const index = this._queue.indexOf(jobId)
    if (index === -1) return null
    const estimate = this.estimateMs()
    const waves = Math.floor(index / Math.max(1, this.concurrency)) + 1
    return { position: index + 1, waiting: this._queue.length, running: this._running.length, estimateMs: (waves + 1) * estimate }
  },

  estimateMs() {
    if (!this._durations.length) return DEFAULT_ESTIMATE_MS
    return this._durations.reduce((sum, ms) => sum + ms, 0) / this._durations.length
  },

  async _configure() {
    if (this._configured) return
    this._configured = true
    try {
      const configured = Number((await productService.getGenerationSettings())?.concurrency)
      if (Number.isFinite(configured) && configured >= 1) {
        this.concurrency = Math.floor(configured)
        this._pump()
      }
    } catch {
      this._configured = false
    }
  },

  _handler(event) {
    const running = this._running.map(id => this.jobs.find(j => j.id === id)).filter(Boolean)
    const target = event?.productId
      ? running.find(j => j.productId === String(event.productId))
      : (running.length === 1 ? running[0] : null)
    if (target) target.messages.push(event)
  },

  _pump() {
    while (this._running.length < this.concurrency) {
      const busy = new Set(this._running.map(id => this.jobs.find(j => j.id === id)?.productId))
      const at = this._queue.findIndex(id => {
        const job = this.jobs.find(j => j.id === id)
        return !job || !busy.has(job.productId)
      })
      if (at === -1) break
      const [jobId] = this._queue.splice(at, 1)
      this._start(jobId)
    }
    this._syncQueue()
  },

  _syncQueue() {
    for (const job of this.jobs) job.queue = job.status === 'pending' ? this.queueInfo(job.id) : null
  },

  _start(jobId) {
    const job = this.jobs.find(j => j.id === jobId)
    if (!job) return

    job.status = 'running'
    job.startedAt = new Date()
    this._running.push(jobId)
    if (!this._listening) {
      this._listening = true
      this._onEvent = (event) => this._handler(event)
      socket.on('generation', this._onEvent)
    }

    productService.generateProduct({ id: job.productId, bump: job.bump })
      .then(result => {
        if (result?.cancelled) {
          job.status = 'cancelled'
          return
        }
        job.status = result.conflicts || result.checksFailed || result.checksDecision === 'reject' ? 'warning' : 'success'
        job.result = { changed: result.changed, conflicts: Boolean(result.conflicts), checksFailed: result.checksFailed ?? null, checksDecision: result.checksDecision ?? null }
        // nothing to commit leaves the version where it was
        if (result.spec?.basicData?.version) job.toVersion = result.spec.basicData.version
        this._durations.push(Date.now() - job.startedAt.getTime())
        if (this._durations.length > REMEMBERED_RUNS) this._durations.shift()
      })
      .catch(() => {
        job.status = 'error'
      })
      .finally(() => {
        job.cancelling = false
        job.finishedAt = new Date()
        this._running = this._running.filter(id => id !== jobId)
        if (!this._running.length && this._listening) {
          this._listening = false
          socket.off('generation', this._onEvent)
        }
        this._pump()
      })
  },
})

export default generationStore
