import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AnalysisRuntimeError, createAnalysisRuntime } from '../../src/index.js'

const REQUIRED_WHEELS = ['micropip-0.6.0-py3-none-any.whl', 'packaging-23.2-py3-none-any.whl']

describe('missing wheels', () => {
  const withEmptyWheelsDir = async (
    assertion: (dir: string) => Promise<void>
  ): Promise<void> => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-core-nowheels-'))
    try {
      await assertion(empty)
    } finally {
      fs.rmSync(empty, { recursive: true, force: true })
    }
  }

  it('raises instead of falling back to the CDN', async () => {
    await withEmptyWheelsDir(async (empty) => {
      await expect(createAnalysisRuntime({ wheelsDir: empty }))
        .rejects.toThrow(AnalysisRuntimeError)
    })
  })

  it('names the wheels that are missing and why it matters', async () => {
    await withEmptyWheelsDir(async (empty) => {
      try {
        await createAnalysisRuntime({ wheelsDir: empty })
        expect.unreachable('should have thrown')
      } catch (error) {
        const message = (error as Error).message
        expect(message).toContain('micropip-0.6.0-py3-none-any.whl')
        expect(message).toContain('packaging-23.2-py3-none-any.whl')
        expect(message).toContain('ADR-002')
      }
    })
  })

  it('fails before booting pyodide, not after', async () => {
    await withEmptyWheelsDir(async (empty) => {
      const started = Date.now()
      await expect(createAnalysisRuntime({ wheelsDir: empty })).rejects.toThrow()
      expect(Date.now() - started).toBeLessThan(1_000)
    })
  })

  it('raises when the wheels are present but corrupt', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-core-badwheels-'))
    try {
      for (const wheel of REQUIRED_WHEELS) {
        fs.writeFileSync(path.join(dir, wheel), 'esto no es un zip', 'utf8')
      }
      await expect(createAnalysisRuntime({ wheelsDir: dir }))
        .rejects.toThrow(AnalysisRuntimeError)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)

  it('ships both wheels in the package itself', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const vendored = path.resolve(here, '..', '..', 'src', 'analysis', 'wheels')
    for (const wheel of REQUIRED_WHEELS) {
      expect(fs.existsSync(path.join(vendored, wheel)), wheel).toBe(true)
    }
  })
})
