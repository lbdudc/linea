import { describe, expect, it, vi } from 'vitest'
import { forgetRecentReads, recentRead } from '../../stores/recentReads.js'

describe('recentRead', () => {
  it('asks once for the same key within the window', async () => {
    forgetRecentReads()
    const load = vi.fn(() => Promise.resolve({ ok: true }))

    await recentRead('line:1', load)
    await recentRead('line:1', load)

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('asks again after everything was forgotten (a line or product changed)', async () => {
    forgetRecentReads()
    const load = vi.fn(() => Promise.resolve(1))

    await recentRead('line:2', load)
    forgetRecentReads()
    await recentRead('line:2', load)

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not keep a failure', async () => {
    forgetRecentReads()
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('fine')

    await expect(recentRead('line:3', load)).rejects.toThrow('down')
    await expect(recentRead('line:3', load)).resolves.toBe('fine')
  })
})
