// The unified patch of a file (from the first `@@` on) as the rows a diff view draws, and the same rows paired for a side-by-side view.

/** `{ type: 'hunk' | 'ctx' | 'add' | 'del', oldLine?, newLine?, text }` for each line of the patch. */
export const parsePatch = (patch) => {
  const rows = []
  const lines = String(patch ?? '').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  let oldLine = 0
  let newLine = 0
  for (const line of lines) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      rows.push({ type: 'hunk', text: line })
      continue
    }
    // "\ No newline at end of file" says nothing about the code
    if (line.startsWith('\\')) continue
    const text = line.slice(1)
    if (line.startsWith('+')) rows.push({ type: 'add', newLine: newLine++, text })
    else if (line.startsWith('-')) rows.push({ type: 'del', oldLine: oldLine++, text })
    else rows.push({ type: 'ctx', oldLine: oldLine++, newLine: newLine++, text })
  }
  return rows
}

/** Rows for two columns: a run of removed lines next to the run of added lines that follows it, a context line on both sides. */
export const splitRows = (rows) => {
  const out = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.type === 'hunk') out.push({ hunk: row })
    else if (row.type === 'ctx') out.push({ left: row, right: row })
    else if (row.type === 'del') {
      const removed = []
      const added = []
      while (rows[i]?.type === 'del') removed.push(rows[i++])
      while (rows[i]?.type === 'add') added.push(rows[i++])
      i -= 1
      for (let k = 0; k < Math.max(removed.length, added.length); k++) out.push({ left: removed[k] ?? null, right: added[k] ?? null })
    } else out.push({ left: null, right: row })
  }
  return out
}
