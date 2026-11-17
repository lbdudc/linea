import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROBE = path.join(ROOT, 'test', 'fixtures', 'adr-002-probe.ts')

describe('ADR-002 lint enforcement', () => {
  const lintProbe = async (): Promise<ESLint.LintResult> => {
    const [result] = await new ESLint({ cwd: ROOT, ignore: false }).lintFiles([PROBE])
    if (result === undefined) throw new Error('probe produced no lint result')
    return result
  }

  it('rejects every static network import spelling', async () => {
    const result = await lintProbe()
    const importMessages = result.messages.filter((m) => m.ruleId === 'no-restricted-imports')
    expect(importMessages.length).toBe(5)
  })

  it('rejects dynamic import() of network modules and clients', async () => {
    const result = await lintProbe()
    const dynamic = result.messages.filter(
      (m) => m.ruleId === 'no-restricted-syntax' && m.message.includes('ADR-002')
    )
    const offenders = dynamic.map((m) => m.line)
    expect(offenders.length).toBeGreaterThanOrEqual(3)
    expect(dynamic.some((m) => m.message.includes('No network modules'))).toBe(true)
    expect(dynamic.some((m) => m.message.includes('No network clients'))).toBe(true)
  })

  it('leaves a legitimate dynamic import alone', async () => {
    const result = await lintProbe()
    const source = await readFile(PROBE, 'utf8')
    const allowedLine = source
      .split('\n')
      .findIndex((line) => line.includes("import('node:path')")) + 1
    expect(allowedLine).toBeGreaterThan(0)
    const onAllowedLine = result.messages.filter((m) => m.line === allowedLine)
    expect(onAllowedLine).toEqual([])
  })

  it('rejects the bare `fetch` global and `globalThis.fetch`', async () => {
    const result = await lintProbe()
    const ruleIds = result.messages.map((m) => m.ruleId)
    expect(ruleIds).toContain('no-restricted-globals')
    expect(ruleIds).toContain('no-restricted-properties')
  })

  it('rejects a fetch call hidden behind a cast', async () => {
    const result = await lintProbe()
    expect(result.messages.map((m) => m.ruleId)).toContain('no-restricted-syntax')
  })

  it('reports every violation as an error, never a warning', async () => {
    const result = await lintProbe()
    expect(result.errorCount).toBeGreaterThanOrEqual(11)
    expect(result.warningCount).toBe(0)
  })

  it('cites ADR-002 in the message so the reason is obvious', async () => {
    const result = await lintProbe()
    const relevant = result.messages.filter((m) =>
      m.ruleId === 'no-restricted-imports' ||
      m.ruleId === 'no-restricted-globals' ||
      m.ruleId === 'no-restricted-properties' ||
      m.ruleId === 'no-restricted-syntax'
    )
    expect(relevant.length).toBeGreaterThan(0)
    for (const message of relevant) {
      expect(message.message, JSON.stringify(message)).toContain('ADR-002')
    }
  })

  it('keeps the real sources clean', async () => {
    const eslint = new ESLint({ cwd: ROOT })
    const results = await eslint.lintFiles([path.join(ROOT, 'src')])
    const offenders = results.flatMap((result) =>
      result.messages.map((message) => `${result.filePath}: ${message.ruleId ?? '?'}`)
    )
    expect(offenders).toEqual([])
  }, 60_000)
})
