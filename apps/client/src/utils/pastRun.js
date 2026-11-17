const CHECKS_NOT_PASSED = new Set(['log.checks_job_failed', 'log.checks_not_passed', 'log.checks_timeout'])

const says = (logs, ...messages) => logs.some(({ message }) => messages.includes(message))

/**
 * A generation that already ran as the dialog that tells a run wants it, from what its log says. `outcome` is what is known of it when it
 * has no log left, `checksOpen` whether its merge request still waits for a person because its checks did not pass, and `checksRequest` the number of the merge request whose checks were run for it.
 */
export const pastRunOf = ({ productId, name, fromVersion = '', version, logs, deployable, historic, pipeline = null, outcome = 'success', checksOpen = false, checksRequest = null }) => {
  const failed = logs.some(({ type }) => type === 'error')
  const warned = logs.some(({ type }) => type === 'warning')
  const notPassed = logs.find(({ message }) => CHECKS_NOT_PASSED.has(message))
  const ended = [...logs].reverse().find(({ type }) => ['error', 'warning', 'success', 'cancelled'].includes(type))
  let status = outcome
  if (ended?.type === 'cancelled') status = 'cancelled'
  else if (failed) status = 'error'
  else if (warned) status = 'warning'
  let decision = null
  if (says(logs, 'log.update_rejected')) decision = 'reject'
  else if (notPassed && says(logs, 'log.merged_merge_request')) decision = 'merge'
  return {
    id: `${productId}-history-${version}`,
    productId,
    name,
    fromVersion,
    toVersion: version,
    status,
    messages: logs,
    result: {
      changed: !says(logs, 'log.empty_diff_up_to_date'),
      conflicts: says(logs, 'log.conflicts_merge_request'),
      ...(checksOpen ? { checksFailed: { job: notPassed?.message === 'log.checks_job_failed' ? notPassed.params?.[0] ?? null : null } } : {}),
    },
    deployable,
    historic,
    pipeline,
    decision,
    checksRequest,
    startedAt: logs[0]?.createdAt ?? null,
  }
}
