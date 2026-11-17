import dagre from '@dagrejs/dagre'

/**
 * The graph of what an SPL's modules resolve to: the SPL, the modules (chosen, or brought in by others and so missing), the
 * metamodels, and who requires what. It is built from the answer of the server (`packages`, each with `requiredBy`), the modules the
 * user chose and, for a circular requirement (which the server refuses without a closure), the message that names the cycle.
 *
 * Returns `{ nodes, edges, cycle }`; every node has a `position` from a left-to-right layered layout (SPL, modules, metamodels).
 */

export const SPL_ID = '__spl__'

const SIZES = {
  spl: { width: 180, height: 52 },
  module: { width: 260, height: 70 },
  metamodel: { width: 220, height: 50 },
}
const OFFERS_ROW_HEIGHT = 22
const CYCLE_PATTERN = /Circular requirement:\s*(.+)$/

// `gitlab:group/pkg@1.2.0` -> `gitlab:group/pkg`
const locationOf = (reference) => reference.replace(/@[^@/]*$/, '')

const cycleOf = (messages) => {
  for (const message of messages ?? []) {
    const found = CYCLE_PATTERN.exec(String(message ?? ''))
    if (found) return found[1].split('->').map((part) => locationOf(part.trim())).filter(Boolean)
  }
  return []
}

export function buildCompositionGraph({ packages = [], chosen = [], nameOf = (l) => l, splName = '', messages = [], direction = 'LR', metamodels = true } = {}) {
  const nodes = new Map()
  const edges = new Map()
  const chosenLocations = new Set(chosen.map((m) => m.location))
  const rangeOf = Object.fromEntries(chosen.map((m) => [m.location, m.range]))

  const addEdge = (source, target, kind, cycle = false) => {
    if (source === target) return
    const id = `${source}->${target}`
    const existing = edges.get(id)
    if (existing) {
      existing.cycle = existing.cycle || cycle
      return
    }
    edges.set(id, { id, source, target, kind, cycle, redundant: false })
  }

  const hasContent = packages.length > 0 || chosen.length > 0
  const cycle = cycleOf(messages)
  if (!hasContent && !cycle.length) return { nodes: [], edges: [], cycle: false }

  nodes.set(SPL_ID, { id: SPL_ID, type: 'spl', label: splName, status: 'spl', version: null, offers: [], range: null, requiredBy: [] })

  for (const p of packages) {
    const isModule = p.kind === 'module'
    nodes.set(p.location, {
      id: p.location,
      type: isModule ? 'module' : 'metamodel',
      label: p.name ?? nameOf(p.location),
      version: p.version ?? null,
      // a module nobody chose is there because another one needs it
      status: isModule ? (chosenLocations.has(p.location) ? 'chosen' : 'missing') : 'resolved',
      offers: isModule ? [...(p.offers ?? [])] : [],
      range: rangeOf[p.location] ?? null,
      requiredBy: [],
    })
  }

  // a chosen module the answer does not have (the check failed, or has not run): it hangs from the SPL as it is
  for (const m of chosen) {
    if (!nodes.has(m.location)) {
      nodes.set(m.location, {
        id: m.location, type: 'module', label: nameOf(m.location), version: null, status: 'unresolved',
        offers: [], range: m.range ?? null, requiredBy: [SPL_ID],
      })
      addEdge(SPL_ID, m.location, 'module')
    }
  }

  for (const p of packages) {
    const node = nodes.get(p.location)
    for (const by of p.requiredBy ?? []) {
      const source = by === 'spl' ? SPL_ID : locationOf(by)
      if (!nodes.has(source)) continue
      if (!node.requiredBy.includes(source)) node.requiredBy.push(source)
      addEdge(source, p.location, p.kind === 'metamodel' ? 'metamodel' : 'module')
    }
  }

  // a circular requirement: its modules and the arrows that close it, whether or not the answer had them
  const inCycle = new Set(cycle)
  cycle.forEach((location, i) => {
    if (!nodes.has(location)) {
      nodes.set(location, {
        id: location, type: 'module', label: nameOf(location), version: null, status: 'cycle',
        offers: [], range: rangeOf[location] ?? null, requiredBy: [],
      })
    }
    if (i > 0) {
      const from = cycle[i - 1]
      addEdge(from, location, 'module', true)
      const target = nodes.get(location)
      if (!target.requiredBy.includes(from)) target.requiredBy.push(from)
    }
  })
  for (const location of inCycle) {
    const node = nodes.get(location)
    node.inCycle = true
  }
  // modules chosen directly and part of a cycle still hang from the SPL
  for (const location of inCycle) {
    if (chosenLocations.has(location)) addEdge(SPL_ID, location, 'module')
  }

  // an arrow that another path already says (the SPL chose A and B, and B needs A) is not drawn: it only adds crossings
  const outgoing = new Map()
  for (const e of edges.values()) {
    if (e.cycle) continue
    if (!outgoing.has(e.source)) outgoing.set(e.source, [])
    outgoing.get(e.source).push(e)
  }
  const reachesAnother = (edge) => {
    const seen = new Set([edge.source])
    const stack = (outgoing.get(edge.source) ?? []).filter((o) => o !== edge).map((o) => o.target)
    while (stack.length) {
      const id = stack.pop()
      if (id === edge.target) return true
      if (seen.has(id)) continue
      seen.add(id)
      for (const o of outgoing.get(id) ?? []) stack.push(o.target)
    }
    return false
  }
  if (!cycle.length) for (const e of edges.values()) e.redundant = reachesAnother(e)

  // without the metamodels the graph is only the SPL and its modules (a big composition is unreadable with them)
  if (!metamodels) {
    for (const [id, node] of [...nodes]) if (node.type === 'metamodel') nodes.delete(id)
    for (const [id, edge] of [...edges]) if (!nodes.has(edge.source) || !nodes.has(edge.target)) edges.delete(id)
  }

  // size and layered layout, left to right
  for (const node of nodes.values()) {
    const base = SIZES[node.type]
    node.width = base.width
    node.height = base.height + (node.type === 'module' && node.offers.length ? OFFERS_ROW_HEIGHT : 0)
  }
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: direction === 'TB' ? 'TB' : 'LR', nodesep: 24, ranksep: 44, marginx: 12, marginy: 12, ranker: 'tight-tree' })
  graph.setDefaultEdgeLabel(() => ({}))
  for (const node of nodes.values()) graph.setNode(node.id, { width: node.width, height: node.height })
  for (const edge of edges.values()) if (!edge.redundant) graph.setEdge(edge.source, edge.target)
  dagre.layout(graph)
  for (const node of nodes.values()) {
    const laid = graph.node(node.id)
    node.position = { x: Math.round(laid.x - node.width / 2), y: Math.round(laid.y - node.height / 2) }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()], cycle: cycle.length > 0 }
}

/** The ids reachable from `id` following the arrows, and those that reach it: what to light up when a node is hovered. */
export function pathsThrough(id, edges) {
  const forward = new Map()
  const backward = new Map()
  for (const e of edges) {
    if (!forward.has(e.source)) forward.set(e.source, [])
    if (!backward.has(e.target)) backward.set(e.target, [])
    forward.get(e.source).push(e.target)
    backward.get(e.target).push(e.source)
  }
  const walk = (start, next) => {
    const seen = new Set()
    const stack = [start]
    while (stack.length) {
      for (const n of next.get(stack.pop()) ?? []) {
        if (!seen.has(n)) {
          seen.add(n)
          stack.push(n)
        }
      }
    }
    return seen
  }
  return new Set([id, ...walk(id, forward), ...walk(id, backward)])
}
