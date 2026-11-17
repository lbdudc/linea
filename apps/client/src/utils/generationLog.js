const TAGS = /<[^>]*>/g

/** How long a step took, for a person: 640 ms, 1.2 s, 14 s. */
export const formatDuration = (ms) => {
  if (ms === null || ms === undefined || Number.isNaN(Number(ms))) return ''
  const value = Number(ms)
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`
}

/** The log of a generation as plain text, one line per step with how long it took. `translate` is the page's `$t`. */
export const logToText = ({ logs, translate, title = '' }) => {
  const timed = logs.filter((log) => typeof log.durationMs === 'number')
  const span = logs.length > 1 ? new Date(logs[logs.length - 1].createdAt).getTime() - new Date(logs[0].createdAt).getTime() : null
  const total = timed.length ? timed.reduce((sum, log) => sum + log.durationMs, 0) : span
  const lines = logs.map((log) => {
    const message = String(translate(log.message, log.params ?? [])).replace(TAGS, '')
    const took = formatDuration(log.durationMs)
    return `${new Date(log.createdAt).toISOString()}  ${String(log.type).toUpperCase().padEnd(9)} ${message}${took ? `  (${took})` : ''}${log.link ? `  ${log.link}` : ''}`
  })
  const head = [title, total === null ? '' : `Total: ${formatDuration(total)}`].filter(Boolean)
  return `${[...head, ...(head.length ? [''] : []), ...lines].join('\n')}\n`
}
