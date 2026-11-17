import { describe, it, expect, vi, beforeEach } from 'vitest'

const { generateProduct, cancelGeneration, handlers } = vi.hoisted(() => ({ generateProduct: vi.fn(), cancelGeneration: vi.fn(), handlers: [] }))
vi.mock('src/services/productService', () => ({ default: { generateProduct, cancelGeneration, getGenerationSettings: () => Promise.reject(new Error('offline')) } }))
vi.mock('src/boot/ws', () => ({
  socket: {
    on: (event, handler) => handlers.push(handler),
    off: (event, handler) => { const at = handlers.indexOf(handler); if (at !== -1) handlers.splice(at, 1) },
    emit: () => {},
  },
}))

import generationStore from 'stores/generationStore'

const tick = () => new Promise((resolve) => setTimeout(resolve, 10))
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

describe('the queue of generations', () => {
  beforeEach(() => {
    generationStore.jobs.splice(0)
    generationStore._queue.splice(0)
    generationStore._running.splice(0)
    generationStore._durations.splice(0)
    generationStore._configured = true
    generationStore._listening = false
    generationStore.concurrency = 1
    generateProduct.mockReset()
    cancelGeneration.mockReset()
    handlers.splice(0)
  })

  it('knows the version each job starts from and the one it would make', () => {
    generateProduct.mockReturnValue(new Promise(() => {}))
    const [id] = generationStore.enqueue([{ _id: 'p1', name: 'A', version: '1.2.3', bump: 'minor' }])
    const job = generationStore.jobs.find((j) => j.id === id)
    expect(job.fromVersion).toBe('1.2.3')
    expect(job.toVersion).toBe('1.3.0')
  })

  it('lets a job that has not started leave the queue, without asking the server for it', async () => {
    const first = deferred()
    generateProduct.mockImplementation(() => first.promise)
    const [firstId, secondId] = generationStore.enqueue([{ _id: 'p1', name: 'A' }, { _id: 'p2', name: 'B' }])

    expect(generationStore.cancel(secondId)).toBe(true)
    expect(generationStore.jobs.find((j) => j.id === secondId).status).toBe('cancelled')
    expect(cancelGeneration).not.toHaveBeenCalled()

    first.resolve({ conflicts: false, changed: true })
    await tick()
    expect(generateProduct).toHaveBeenCalledTimes(1)
    expect(generationStore.jobs.find((j) => j.id === firstId).status).toBe('success')
  })

  it('runs the jobs in the order they were asked, one after the other, when the concurrency is 1', async () => {
    const runs = []
    generateProduct.mockImplementation(({ id }) => { const run = deferred(); runs.push({ id, ...run }); return run.promise })
    generationStore.enqueue([{ _id: 'p1', name: 'A' }, { _id: 'p2', name: 'B' }, { _id: 'p3', name: 'C' }])

    expect(runs.map((run) => run.id)).toEqual(['p1'])
    runs[0].resolve({ conflicts: false })
    await tick()
    expect(runs.map((run) => run.id)).toEqual(['p1', 'p2'])
    runs[1].resolve({ conflicts: false })
    await tick()
    expect(runs.map((run) => run.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('never has more jobs running than the concurrency allows, and starts the next one as soon as a place is free', async () => {
    generationStore.concurrency = 3
    const runs = []
    generateProduct.mockImplementation(({ id }) => { const run = deferred(); runs.push({ id, ...run }); return run.promise })
    generationStore.enqueue(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((_id) => ({ _id, name: _id })))

    expect(generateProduct).toHaveBeenCalledTimes(3)
    expect(generationStore._running).toHaveLength(3)
    runs[1].resolve({ conflicts: false })
    await tick()
    expect(generateProduct).toHaveBeenCalledTimes(4)
    expect(generationStore._running).toHaveLength(3)
    expect(runs.map((run) => run.id)).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('does not run the same product twice at once: the second waits for the first', async () => {
    generationStore.concurrency = 3
    const runs = []
    generateProduct.mockImplementation(({ id }) => { const run = deferred(); runs.push({ id, ...run }); return run.promise })
    generationStore.enqueue([{ _id: 'p1', name: 'A' }, { _id: 'p1', name: 'A again' }, { _id: 'p2', name: 'B' }])

    expect(runs.map((run) => run.id)).toEqual(['p1', 'p2'])
    runs[0].resolve({ conflicts: false })
    await tick()
    expect(runs.map((run) => run.id)).toEqual(['p1', 'p2', 'p1'])
  })

  it('says where a waiting job stands: its place and about when it ends', async () => {
    generationStore.concurrency = 2
    generateProduct.mockReturnValue(new Promise(() => {}))
    const ids = generationStore.enqueue(['p1', 'p2', 'p3', 'p4', 'p5'].map((_id) => ({ _id, name: _id })))
    const job = (id) => generationStore.jobs.find((j) => j.id === id)

    expect(job(ids[0]).queue).toBeNull()
    expect(job(ids[2]).queue).toMatchObject({ position: 1, waiting: 3, running: 2 })
    expect(job(ids[4]).queue).toMatchObject({ position: 3, waiting: 3 })
    expect(job(ids[2]).queue.estimateMs).toBeLessThan(job(ids[4]).queue.estimateMs)

    generationStore.cancel(ids[2])
    expect(job(ids[3]).queue.position).toBe(1)
    expect(job(ids[2]).queue).toBeNull()
  })

  it('asks the server to stop a running job, which then shows as cancelled', async () => {
    const run = deferred()
    generateProduct.mockReturnValue(run.promise)
    cancelGeneration.mockResolvedValue({ status: 'cancelling' })
    const [id] = generationStore.enqueue([{ _id: 'p1', name: 'A' }])
    const job = generationStore.jobs.find((j) => j.id === id)

    expect(generationStore.cancel(id)).toBe(true)
    await tick()
    expect(cancelGeneration).toHaveBeenCalledWith({ id: 'p1' })
    expect(job.cancelling).toBe(true)
    expect(generationStore.cancel(id)).toBe(false)

    run.resolve({ cancelled: true, productId: 'p1' })
    await tick()
    expect(job.status).toBe('cancelled')
    expect(job.cancelling).toBe(false)
  })

  it('says so when the generation was already writing and could not be stopped', async () => {
    generateProduct.mockReturnValue(new Promise(() => {}))
    cancelGeneration.mockResolvedValue({ status: 'committing' })
    const [id] = generationStore.enqueue([{ _id: 'p1', name: 'A' }])
    const job = generationStore.jobs.find((j) => j.id === id)

    generationStore.cancel(id)
    await tick()
    expect(job.cancelling).toBe(false)
    expect(job.cancelRefused).toBe(true)
    expect(job.status).toBe('running')
  })

  it('gives each job the events of its own product while several run', async () => {
    generationStore.concurrency = 2
    generateProduct.mockReturnValue(new Promise(() => {}))
    const [a, b] = generationStore.enqueue([{ _id: 'p1', name: 'A' }, { _id: 'p2', name: 'B' }])

    expect(handlers).toHaveLength(1)
    handlers[0]({ productId: 'p2', message: 'log.downloaded_spl', type: 'info' })
    handlers[0]({ productId: 'p1', message: 'log.deriving_code', type: 'info' })
    handlers[0]({ productId: 'p3', message: 'log.other', type: 'info' })

    expect(generationStore.jobs.find((j) => j.id === a).messages.map((m) => m.message)).toEqual(['log.deriving_code'])
    expect(generationStore.jobs.find((j) => j.id === b).messages.map((m) => m.message)).toEqual(['log.downloaded_spl'])
  })

  it('stops listening to the server when nothing is running', async () => {
    generateProduct.mockResolvedValue({ conflicts: false })
    generationStore.enqueue([{ _id: 'p1', name: 'A' }])
    await tick()
    expect(handlers).toHaveLength(0)
  })

  it('estimates from how long the last generations took', async () => {
    expect(generationStore.estimateMs()).toBe(15000)
    generationStore._durations.push(2000, 4000)
    expect(generationStore.estimateMs()).toBe(3000)
  })
})
