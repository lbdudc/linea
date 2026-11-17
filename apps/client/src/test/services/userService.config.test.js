import { describe, it, expect, vi, beforeEach } from 'vitest'

const get = vi.fn()
vi.mock('src/boot/axios', () => ({ api: { get: (...args) => get(...args) } }))

describe('userService.getConfig', () => {
  beforeEach(() => { vi.resetModules(); get.mockReset() })

  it('asks the server once for callers that overlap or come later', async () => {
    get.mockResolvedValue({ data: { hosts: [{ id: 'local' }], primary: 'local' } })
    const { default: userService } = await import('src/services/userService')
    const [a, b] = await Promise.all([userService.getConfig(), userService.getConfig()])
    expect(a).toBe(b)
    await userService.getConfig()
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('asks again after a failure and after forgetConfig', async () => {
    get.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ data: { hosts: [] } })
    const { default: userService } = await import('src/services/userService')
    await expect(userService.getConfig()).rejects.toThrow('down')
    await userService.getConfig()
    expect(get).toHaveBeenCalledTimes(2)
    userService.forgetConfig()
    await userService.getConfig()
    expect(get).toHaveBeenCalledTimes(3)
  })
})
