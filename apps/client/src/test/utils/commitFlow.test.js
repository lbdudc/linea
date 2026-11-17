import { describe, it, expect } from 'vitest'
import { commitFlowOf, commitStarted, logOfStep, stagesOf } from 'src/utils/commitFlow'

const MADE = { message: 'log.generated_product' }
const BRANCH = { message: 'log.created_branch', params: ['generation/1.0.1', 'bigbang'] }
const COMMIT = { message: 'log.commited_generation', params: ['generation/1.0.1'] }
const REQUEST = { message: 'log.created_merge_request', params: ['generation/1.0.1', 'bigbang'] }
const MERGE = { message: 'log.merged_merge_request_deleted', params: ['generation/1.0.1', 'bigbang'] }
const UPDATE = { message: 'log.created_merge_request', params: ['bigbang', 'main'] }
const WAITING = { message: 'log.waiting_checks' }
const RELEASE = { message: 'log.merged_merge_request', params: ['bigbang', 'main'] }
const JOB_FAILED = { message: 'log.checks_job_failed', params: ['client_build'] }
const TO_BASE = [MADE, BRANCH, COMMIT, REQUEST, MERGE, UPDATE]

const states = (messages, status) => Object.fromEntries(commitFlowOf(messages, status).steps.map(({ key, state }) => [key, state]))
const step = (flow, key) => flow.steps.find((candidate) => candidate.key === key)

describe('what the log says of each step', () => {
  const log = [...TO_BASE, WAITING, JOB_FAILED, { message: 'log.checks_not_passed', params: ['failed'] }]

  it('tells the request of the generation from the one to the default branch', () => {
    expect(logOfStep(log, 'done', 'request')).toEqual([REQUEST])
    expect(logOfStep(log, 'done', 'update')).toEqual([UPDATE])
  })

  it('gathers all that was said of the checks', () => {
    expect(logOfStep(log, 'done', 'checks')).toHaveLength(3)
  })

  it('tells the conflicts by the branch they are in', () => {
    const inGeneration = { message: 'log.conflicts_merge_request', params: ['generation/1.0.1', 'bigbang'] }
    const inBase = { message: 'log.conflicts_merge_request', params: ['bigbang', 'main'] }
    expect(logOfStep([BRANCH, inGeneration], 'done', 'merge')).toEqual([inGeneration])
    expect(logOfStep([BRANCH, inBase], 'done', 'release')).toEqual([inBase])
  })

  it('takes an error to the step that failed, and only to it', () => {
    const error = { message: 'error_messages.internal_error', type: 'error' }
    const failing = [MADE, BRANCH, error]
    expect(logOfStep(failing, 'failed', 'commit')).toEqual([error])
    expect(logOfStep(failing, 'failed', 'branch')).toEqual([BRANCH])
  })
})

describe('the way of a generation to the repository', () => {
  it('has nothing going on before the code is made', () => {
    expect(Object.values(states([{ message: 'log.deriving_code' }], 'running')).every((state) => state === 'pending')).toBe(true)
    expect(commitStarted([{ message: 'log.deriving_code' }])).toBe(false)
  })

  it('has the next step going as each one is told', () => {
    expect(states([MADE], 'running').branch).toBe('active')
    expect(states([MADE, BRANCH, COMMIT], 'running')).toMatchObject({ branch: 'done', commit: 'done', request: 'active', merge: 'pending' })
  })

  it('takes the two merge requests for what they are, and the branches from the log', () => {
    const flow = commitFlowOf(TO_BASE, 'running')
    expect(step(flow, 'request').state).toBe('done')
    expect(step(flow, 'update').state).toBe('done')
    expect(flow.branches).toEqual({ generation: 'generation/1.0.1', base: 'bigbang', main: 'main' })
  })

  it('stays at the checks while they are waited for, and nothing goes on after them', () => {
    expect(states([...TO_BASE, WAITING], 'running')).toMatchObject({ checks: 'active', release: 'pending' })
  })

  it('waits for a decision when the checks were not over in time, until it is told what followed', () => {
    const timedOut = { message: 'log.checks_timeout', params: [30] }
    const waiting = commitFlowOf([...TO_BASE, WAITING, timedOut], 'done')
    expect(step(waiting, 'checks')).toEqual({ key: 'checks', state: 'warning', note: 'checks_timeout' })
    expect(step(waiting, 'release')).toEqual({ key: 'release', state: 'pending', note: 'awaiting_decision' })
    const merged = commitFlowOf([...TO_BASE, WAITING, timedOut, { message: 'log.merged_merge_request', params: ['bigbang', 'main'] }], 'done')
    expect(step(merged, 'release')).toEqual({ key: 'release', state: 'done' })
  })

  it.each([
    [{ message: 'log.checks_none' }, 'skipped', 'no_checks'],
    [{ message: 'log.checks_finished', params: ['success'] }, 'done', undefined],
  ])('goes on to the merge after checks that end so: %j', (end, state, note) => {
    const flow = commitFlowOf([...TO_BASE, WAITING, end], 'running')
    expect(step(flow, 'checks')).toEqual({ key: 'checks', state, ...(note ? { note } : {}) })
    expect(step(flow, 'release').state).toBe('active')
  })

  it.each([
    [JOB_FAILED, { key: 'checks', state: 'failed', note: 'checks_failed', job: 'client_build' }],
    [{ message: 'log.checks_not_passed', params: ['failed'] }, { key: 'checks', state: 'failed', note: 'checks_failed' }],
    [{ message: 'log.checks_not_passed', params: ['canceled'] }, { key: 'checks', state: 'warning', note: 'checks_canceled' }],
  ])('waits for a person after checks that did not pass: %j', (end, checks) => {
    const flow = commitFlowOf([...TO_BASE, WAITING, end], 'done')
    expect(step(flow, 'checks')).toEqual(checks)
    expect(step(flow, 'release')).toEqual({ key: 'release', state: 'pending', note: 'awaiting_decision' })
    expect(flow.undecided).toBe(true)
  })

  it('shows what was decided', () => {
    const failed = [...TO_BASE, WAITING, JOB_FAILED]
    const merged = commitFlowOf([...failed, RELEASE], 'done')
    expect(step(merged, 'release').state).toBe('done')
    expect(merged.undecided).toBe(false)
    expect(step(commitFlowOf([...failed, { message: 'log.update_rejected', params: ['1.0.1'] }], 'done'), 'release')).toEqual({ key: 'release', state: 'warning', note: 'rejected' })
  })

  it('leaves the checks skipped when a run with no CI merges', () => {
    expect(states([...TO_BASE, RELEASE], 'done')).toMatchObject({ checks: 'skipped', release: 'done' })
  })

  it('stops at a merge that conflicts, on whichever branch', () => {
    const first = [MADE, BRANCH, COMMIT, REQUEST, { message: 'log.conflicts_merge_request', params: ['generation/1.0.1', 'bigbang'] }]
    expect(states(first, 'done')).toMatchObject({ merge: 'warning', update: 'pending', release: 'pending' })
    expect(states([...TO_BASE, { message: 'log.conflicts_merge_request', params: ['bigbang', 'main'] }], 'done')).toMatchObject({ release: 'warning' })
  })

  it('marks the step that failed', () => {
    expect(states([MADE, BRANCH], 'failed')).toMatchObject({ branch: 'done', commit: 'failed', request: 'pending' })
  })

  it('leaves the merge for a person when the product does not merge its own updates', () => {
    expect(states(TO_BASE, 'done')).toMatchObject({ update: 'done', checks: 'pending', release: 'pending' })
  })

  it('has what a run left halfway skipped when another one finishes it', () => {
    expect(states([UPDATE, RELEASE], 'done')).toMatchObject({ branch: 'skipped', merge: 'skipped', update: 'done', release: 'done' })
  })
})

describe('the stage of each message', () => {
  const failure = { message: 'error_messages.error_merging', type: 'error' }

  it('follows the timeline: the code, and its way to the default branch', () => {
    const log = [{ message: 'log.deriving_code' }, MADE, BRANCH, COMMIT, REQUEST, MERGE, UPDATE, WAITING, JOB_FAILED, RELEASE]
    expect(stagesOf(log)).toEqual(['generate', 'generate', 'deploy', 'deploy', 'deploy', 'deploy', 'deploy', 'deploy', 'deploy', 'deploy'])
  })

  it('takes a failure to where the run was', () => {
    expect(stagesOf([{ message: 'log.deriving_code' }, failure]).at(-1)).toBe('generate')
    expect(stagesOf([MADE, BRANCH, failure]).at(-1)).toBe('deploy')
    expect(stagesOf([...TO_BASE, failure]).at(-1)).toBe('deploy')
  })

  it('says when each part has begun', () => {
    expect(commitStarted([MADE])).toBe(true)
    expect(commitStarted([{ message: 'log.deriving_code' }])).toBe(false)
  })

  it('finds the update of a run that finishes one left halfway', () => {
    expect(stagesOf([{ message: 'log.empty_diff_up_to_date' }, UPDATE, RELEASE])).toEqual(['generate', 'deploy', 'deploy'])
  })
})
