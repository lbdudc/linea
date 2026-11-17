import { afterAll, beforeAll, describe, expect, it } from 'vitest'

type RestoreFn = () => void
interface Attempt { kind: string, target: string }
const attempts: Attempt[] = []

const record = (kind: string, target: unknown): never => {
  attempts.push({ kind, target: String(target) })
  throw new Error(`ADR-002: blocked outbound ${kind} to ${String(target)}`)
}

let restore: RestoreFn[] = []

beforeAll(async () => {
  const globals = globalThis as unknown as Record<string, unknown>

  const realFetch = globals.fetch
  globals.fetch = (input: unknown): never =>
    record('fetch', typeof input === 'string' ? input : (input as { url?: string })?.url ?? input)
  restore.push(() => { globals.fetch = realFetch })

  const http = (await import('node:http')).default
  const https = (await import('node:https')).default
  for (const [name, mod] of [['http', http], ['https', https]] as const) {
    for (const fn of ['request', 'get'] as const) {
      const real = mod[fn]
      const patched = (...args: unknown[]): never => {
        const first = args[0] as { href?: string, hostname?: string } | string
        return record(`${name}.${fn}`, typeof first === 'string' ? first : first?.href ?? first?.hostname)
      }
      ;(mod as unknown as Record<string, unknown>)[fn] = patched
      restore.push(() => { (mod as unknown as Record<string, unknown>)[fn] = real })
    }
  }

  const net = (await import('node:net')).default
  const socketProto = net.Socket.prototype as unknown as Record<string, unknown>
  const realConnect = socketProto.connect
  socketProto.connect = (...args: unknown[]): never => {
    const target = args[0] as { host?: string, port?: number } | string
    return record('net.connect', typeof target === 'string' ? target : target?.host)
  }
  restore.push(() => { socketProto.connect = realConnect })

  const dns = (await import('node:dns')).default
  const realLookup = dns.lookup
  dns.lookup = ((hostname: string): never => record('dns.lookup', hostname)) as unknown as typeof realLookup
  restore.push(() => { dns.lookup = realLookup })
})

afterAll(() => {
  for (const undo of restore) undo()
  restore = []
})

describe('ADR-002: the analysis runtime is fully offline', () => {
  it('boots, analyses and disposes without opening a single connection', async () => {
    const {
      analyzeFeatureModel,
      createAnalysisRuntime,
      disposeAnalysisRuntime
    } = await import('../../src/index.js')

    const runtime = await createAnalysisRuntime()
    try {
      const result = await analyzeFeatureModel({
        uvl: 'features\n    Shop\n        mandatory\n            Catalog\n',
        runtime
      })
      expect(result.coreFeatures).toEqual(expect.arrayContaining(['Shop', 'Catalog']))
      expect(result.satisfiable).toBe(true)
    } finally {
      disposeAnalysisRuntime({ runtime })
    }

    expect(attempts, `network was used: ${JSON.stringify(attempts)}`).toEqual([])
  }, 180_000)

  it('proves the interceptor actually fires', () => {
    expect(() => globalThis.fetch('https://example.invalid')).toThrow(/ADR-002/)
    expect(attempts.at(-1)?.target).toContain('example.invalid')
    attempts.length = 0
  })
})
