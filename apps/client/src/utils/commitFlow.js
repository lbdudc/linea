const STEPS = ['branch', 'commit', 'request', 'merge', 'update', 'checks', 'release']
const CHECKS_MESSAGES = new Set([
  'log.waiting_checks', 'log.checks_status', 'log.checks_none', 'log.checks_finished', 'log.checks_timeout', 'log.checks_job_failed', 'log.checks_not_passed',
  'log.checks_policy_ask', 'log.checks_policy_merge', 'log.checks_policy_reject', 'log.checks_await_decision', 'log.checks_merge_anyway',
])
const DEPLOY_MESSAGES = new Set([
  ...CHECKS_MESSAGES, 'log.created_branch', 'log.generation_branch_taken', 'log.commited_generation', 'log.created_merge_request', 'log.conflicts_merge_request',
  'log.merged_merge_request_deleted', 'log.merged_merge_request', 'log.update_rejected',
])

/**
 * The stage of a generation each message of its log belongs to, in order: `generate` until the code is made, and `deploy` from there to the
 * default branch. What is not known to a stage (a failure) goes with where the run was.
 */
export const stagesOf = (messages) => {
  let stage = 'generate'
  return messages.map(({ message }) => {
    if (message === 'log.generated_product') {
      stage = 'deploy'
      return 'generate'
    }
    if (DEPLOY_MESSAGES.has(message)) stage = 'deploy'
    return stage
  })
}

/** Whether the code of a generation has started its way to the repository: it is made, or a later step has been told. */
export const commitStarted = (messages) => messages.some(({ message }) => message === 'log.generated_product') || stagesOf(messages).some((stage) => stage !== 'generate')

const checksOutcome = ([status] = []) => {
  if (status === 'success') return { state: 'done' }
  return { state: 'skipped' }
}
const checksNotPassed = ([status] = []) => (status === 'canceled'
  ? { state: 'warning', note: 'checks_canceled', notPassed: true }
  : { state: 'failed', note: 'checks_failed', notPassed: true })

/**
 * The way of a generation to the repository, from its log: from the branch of the generation to the base branch and on to the default one.
 * `status` is how the run stands: `running`, `done` or `failed`. What the log skipped (a run that finishes one left halfway) is `skipped`.
 */
export const commitFlowOf = (messages, status) => {
  const marks = {}
  const branches = { generation: null, base: null, main: null }
  let stopped = false
  for (const { message, params = [] } of messages) {
    const [source, target] = params
    if (message === 'log.created_branch') {
      branches.generation = source
      branches.base = target
      marks.branch = { state: 'done' }
    } else if (message === 'log.commited_generation') {
      marks.commit = { state: 'done' }
    } else if (message === 'log.created_merge_request') {
      if (source === branches.generation) {
        marks.request = { state: 'done' }
      } else {
        branches.base = source
        branches.main = target
        marks.update = { state: 'done' }
      }
    } else if (message === 'log.merged_merge_request_deleted') {
      marks.merge = { state: 'done' }
    } else if (message === 'log.merged_merge_request') {
      marks.release = { state: 'done' }
    } else if (message === 'log.update_rejected') {
      marks.release = { state: 'warning', note: 'rejected' }
    } else if (message === 'log.conflicts_merge_request') {
      marks[source === branches.generation ? 'merge' : 'release'] = { state: 'warning', note: 'conflicts' }
      stopped = true
    } else if (message === 'log.waiting_checks') {
      marks.checks = { state: 'active' }
    } else if (message === 'log.checks_none') {
      marks.checks = { state: 'skipped', note: 'no_checks' }
    } else if (message === 'log.checks_timeout') {
      marks.checks = { state: 'warning', note: 'checks_timeout', notPassed: true }
    } else if (message === 'log.checks_finished') {
      marks.checks = checksOutcome(params)
    } else if (message === 'log.checks_not_passed') {
      marks.checks = checksNotPassed(params)
    } else if (message === 'log.checks_job_failed') {
      marks.checks = { state: 'failed', note: 'checks_failed', notPassed: true, job: source }
    }
  }

  const started = commitStarted(messages)
  const undecided = Boolean(marks.checks?.notPassed) && !marks.release
  const last = STEPS.reduce((found, key, index) => (marks[key] ? index : found), -1)
  const waiting = marks[STEPS[last]]?.state === 'active'
  const steps = STEPS.map((key, index) => {
    const mark = marks[key]
    if (mark?.state === 'active' && status !== 'running') return { key, state: status === 'failed' ? 'failed' : 'skipped' }
    if (mark) {
      const { notPassed, ...shown } = mark
      return { key, ...shown }
    }
    if (index < last) return { key, state: 'skipped' }
    if (key === 'release' && undecided) return { key, state: 'pending', note: 'awaiting_decision' }
    if (index > last + 1 || !started || stopped || waiting) return { key, state: 'pending' }
    if (status === 'running') return { key, state: 'active' }
    return { key, state: status === 'failed' ? 'failed' : 'pending' }
  })
  return { steps, branches, started, undecided }
}

const stepOfMessage = ({ message, params = [] }, generation) => {
  if (CHECKS_MESSAGES.has(message)) return 'checks'
  const ownBranch = params[0] === generation
  return {
    'log.created_branch': 'branch',
    'log.generation_branch_taken': 'branch',
    'log.commited_generation': 'commit',
    'log.created_merge_request': ownBranch ? 'request' : 'update',
    'log.merged_merge_request_deleted': 'merge',
    'log.conflicts_merge_request': ownBranch ? 'merge' : 'release',
    'log.merged_merge_request': 'release',
    'log.update_rejected': 'release',
  }[message] ?? null
}

/** The step of the drawing each message of a log tells about, in order; `null` for those that tell about none. */
export const stepsOfLog = (messages) => {
  const generation = messages.find(({ message }) => message === 'log.created_branch')?.params?.[0]
  return messages.map((message) => stepOfMessage(message, generation))
}

/** What the log says of a step of the drawing; of the step where the run failed, also the errors of the stage. */
export const logOfStep = (messages, status, key) => {
  const failed = commitFlowOf(messages, status).steps.find((step) => step.key === key)?.state === 'failed'
  const steps = stepsOfLog(messages)
  const stages = stagesOf(messages)
  return messages.filter((message, index) => steps[index] === key || (failed && message.type === 'error' && stages[index] === 'deploy'))
}
