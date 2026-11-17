import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestEnded, requestStarted, SLOW_AFTER_MS, slowRequests } from '../../stores/slowRequests.js'

afterEach(() => { vi.useRealTimers() })

describe('slowRequests', () => {
  it('counts a request that has not ended after the threshold, and stops when it ends', () => {
    vi.useFakeTimers()
    const request = {}

    requestStarted(request)
    vi.advanceTimersByTime(SLOW_AFTER_MS - 1)
    expect(slowRequests.count).toBe(0)
    vi.advanceTimersByTime(2)
    expect(slowRequests.count).toBe(1)

    requestEnded(request)
    expect(slowRequests.count).toBe(0)
  })

  it('never counts a request that ends in time', () => {
    vi.useFakeTimers()
    const request = {}

    requestStarted(request)
    requestEnded(request)
    vi.advanceTimersByTime(SLOW_AFTER_MS * 2)

    expect(slowRequests.count).toBe(0)
  })
})
