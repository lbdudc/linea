/** The statuses of a pipeline that has stopped. */
export const PIPELINE_FINAL = ['success', 'failed', 'canceled', 'skipped', 'manual']

const PIPELINE_COLOR_VAR = {
  success: 'var(--status-ok)',
  failed: 'var(--status-bad)',
  running: 'var(--p-primary-color)',
  pending: 'var(--text-muted)'
}

/** The colour a pipeline status is shown in. */
export const pipelineColorVar = (status) => PIPELINE_COLOR_VAR[status] ?? 'var(--p-text-faint-color)'

/** The word a pipeline status is told with (`generation.gr_pipeline_<word>`): anything that has not stopped is `running`. */
export const pipelineWord = (status) => (PIPELINE_FINAL.includes(status) ? status : 'running')
