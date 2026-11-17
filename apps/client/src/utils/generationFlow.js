const PACKAGE_KINDS = { 'log.resolving_module': 'modules', 'log.resolving_metamodel': 'metamodels' }
const STAGE_MESSAGES = { 'log.checking_product': 'check', 'log.composing_platform': 'platform', 'log.deriving_code': 'derive' }
const STAGES = ['check', 'platform', 'derive']
const DERIVED_MESSAGES = new Set(['log.prettied_code', 'log.generated_product', 'log.empty_diff_up_to_date'])

/** The name a package is told by: the end of its location. */
export const packageName = (location) => String(location).split('/').pop().replace(/-component$/, '')

const requirersOf = (value) => {
  if (Array.isArray(value)) return value.map(String)
  return value ? [String(value)] : []
}

/**
 * What the log of a generation says of its progress: the packages downloaded so far, what ties them, and how far the derivation went.
 * Packages are downloaded one after another, so each one is over when the next begins, or when the derivation does.
 * `status` is how the run stands: `running`, `done` or `failed`.
 */
export const flowOf = (messages, status) => {
  const packages = new Map()
  const reached = new Set()
  let derived = false
  for (const message of messages) {
    const kind = PACKAGE_KINDS[message.message]
    if (kind) {
      const [location, version, requiredBy] = message.params ?? []
      if (location && !packages.has(location)) packages.set(location, { id: location, kind, name: packageName(location), version, requiredBy: requirersOf(requiredBy) })
    }
    if (STAGE_MESSAGES[message.message]) reached.add(STAGE_MESSAGES[message.message])
    if (DERIVED_MESSAGES.has(message.message)) derived = true
  }

  const last = STAGES.reduce((found, stage, index) => (reached.has(stage) ? index : found), -1)
  const stageState = (index) => {
    if (status === 'done' || derived) return 'done'
    if (index < last) return 'done'
    if (index > last) return 'pending'
    return status === 'failed' ? 'failed' : 'active'
  }
  const stages = STAGES.map((key, index) => ({ key, state: stageState(index) }))

  const all = [...packages.values()]
  const newest = all[all.length - 1]
  const downloading = last < 0 && !derived && status !== 'done'
  const packageState = (pkg) => {
    if (!downloading || pkg !== newest) return 'done'
    return status === 'failed' ? 'failed' : 'downloading'
  }
  const nodes = all.map((pkg) => ({ ...pkg, state: packageState(pkg) }))
  const placed = new Set(all.map(({ id }) => id))
  const links = nodes.flatMap((node) => node.requiredBy.filter((from) => placed.has(from)).map((from) => ({ from, to: node.id, active: node.state === 'downloading' })))

  return { modules: nodes.filter(({ kind }) => kind === 'modules'), metamodels: nodes.filter(({ kind }) => kind === 'metamodels'), links, stages }
}

const STAGE_LOGS = { ...STAGE_MESSAGES, 'log.prettied_code': 'derive', 'log.generated_product': 'derive', 'log.empty_diff_up_to_date': 'derive' }

/** The node of the drawing a message of the log tells about: the location of a package or the key of a stage. */
export const flowNodeOf = ({ message, params = [] }) => (PACKAGE_KINDS[message] ? params[0] : STAGE_LOGS[message]) ?? null

/** What the log says of a node of the drawing; of the node where the run failed, also the errors. */
export const logOfFlowNode = (messages, status, key) => {
  const { modules, metamodels, stages } = flowOf(messages, status)
  const failed = [...modules, ...metamodels, ...stages].some((node) => (node.id ?? node.key) === key && node.state === 'failed')
  return messages.filter((message) => flowNodeOf(message) === key || (failed && message.type === 'error'))
}

/** Whether a log says anything to draw: a log from before modules, or with nothing but a failure, does not. */
export const hasFlow = (messages) => messages.some(({ message }) => PACKAGE_KINDS[message] || STAGE_MESSAGES[message])
