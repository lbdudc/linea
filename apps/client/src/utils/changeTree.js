const compact = (node) => {
  for (const child of node.children) compact(child)
  while (node.path !== '' && node.children.length === 1 && !node.children[0].file) {
    const only = node.children[0]
    node.name = `${node.name}/${only.name}`
    node.path = only.path
    node.children = only.children
  }
  return node
}

const count = (node) => {
  if (node.file) {
    node.total = 1
    node.counts = { [node.file.action]: 1 }
    return node
  }
  node.total = 0
  node.counts = {}
  for (const child of node.children) {
    count(child)
    node.total += child.total
    for (const [action, n] of Object.entries(child.counts)) node.counts[action] = (node.counts[action] ?? 0) + n
  }
  return node
}

/**
 * The changed files of a generation as folders: `[{ name, path, children, file?, total, counts }]`. A folder that holds only another
 * folder is joined with it (`src/main/java`), folders come before files, and each folder knows how many files of each action it holds.
 */
export const changeTree = (files) => {
  const root = { name: '', path: '', children: [] }
  for (const file of files) {
    const parts = String(file.path).split('/')
    let node = root
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/')
      const last = index === parts.length - 1
      let child = node.children.find((candidate) => candidate.name === part && Boolean(candidate.file) === last)
      if (!child) {
        child = last ? { name: part, path, children: [], file } : { name: part, path, children: [] }
        node.children.push(child)
      }
      node = child
    })
  }
  const order = (node) => {
    node.children.sort((a, b) => (Boolean(a.file) - Boolean(b.file)) || a.name.localeCompare(b.name))
    node.children.forEach(order)
  }
  order(root)
  count(root)
  return root.children.map((child) => compact(child))
}
