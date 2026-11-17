import { describe, it, expect } from 'vitest'
import { pastRunOf } from 'src/utils/pastRun'

const base = { productId: 'p', name: 'Tienda', version: '1.0.1', deployable: true, historic: true }
const FAILED_CHECKS = { message: 'log.checks_job_failed', params: ['client_build'], type: 'warning' }

describe('a past generation as the dialog wants it', () => {
  it('takes its state from the log', () => {
    expect(pastRunOf({ ...base, logs: [{ message: 'x', type: 'info' }] }).status).toBe('success')
    expect(pastRunOf({ ...base, logs: [FAILED_CHECKS] }).status).toBe('warning')
    expect(pastRunOf({ ...base, logs: [FAILED_CHECKS, { message: 'y', type: 'error' }] }).status).toBe('error')
  })

  it('falls back on what is known of a run without log', () => {
    expect(pastRunOf({ ...base, logs: [], outcome: 'error' }).status).toBe('error')
  })

  it('does not take checks that did not pass for conflicts', () => {
    expect(pastRunOf({ ...base, logs: [FAILED_CHECKS] }).result.conflicts).toBe(false)
    expect(pastRunOf({ ...base, logs: [{ message: 'log.conflicts_merge_request', type: 'warning' }] }).result.conflicts).toBe(true)
  })

  it('says a run that made nothing made nothing', () => {
    expect(pastRunOf({ ...base, logs: [{ message: 'log.empty_diff_up_to_date', type: 'success' }] }).result.changed).toBe(false)
  })

  it('tells that checks that did not finish in time were merged anyway', () => {
    const logs = [{ message: 'log.checks_timeout', params: [30] }, { message: 'log.merged_merge_request' }]
    expect(pastRunOf({ ...base, logs }).decision).toBe('merge')
  })

  it('keeps the request whose checks it tells', () => {
    expect(pastRunOf({ ...base, logs: [], checksRequest: 3 }).checksRequest).toBe(3)
    expect(pastRunOf({ ...base, logs: [] }).checksRequest).toBeNull()
  })

  it('asks for a decision only while the request waits for it', () => {
    expect(pastRunOf({ ...base, logs: [FAILED_CHECKS] }).result.checksFailed).toBeUndefined()
    expect(pastRunOf({ ...base, logs: [FAILED_CHECKS], checksOpen: true }).result.checksFailed).toEqual({ job: 'client_build' })
  })

  it('remembers what a person decided', () => {
    expect(pastRunOf({ ...base, logs: [FAILED_CHECKS, { message: 'log.update_rejected' }] }).decision).toBe('reject')
    expect(pastRunOf({ ...base, logs: [FAILED_CHECKS, { message: 'log.merged_merge_request' }] }).decision).toBe('merge')
    expect(pastRunOf({ ...base, logs: [{ message: 'log.merged_merge_request' }] }).decision).toBeNull()
  })
})
