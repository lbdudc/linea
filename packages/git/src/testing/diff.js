// A unified diff of two texts, line by line (the doubles' stand-in for what a git host answers): hunks of three lines of context.
export function unifiedDiff(oldText, newText, context = 3) {
  const split = (text) => { const lines = String(text ?? '').split('\n'); if (lines[lines.length - 1] === '') lines.pop(); return lines; };
  const a = split(oldText);
  const b = split(newText);
  // longest common subsequence
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push({ t: ' ', text: a[i], a: i + 1, b: j + 1 }); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) { ops.push({ t: '-', text: a[i], a: i + 1 }); i++; }
    else { ops.push({ t: '+', text: b[j], b: j + 1 }); j++; }
  }
  while (i < a.length) { ops.push({ t: '-', text: a[i], a: i + 1 }); i++; }
  while (j < b.length) { ops.push({ t: '+', text: b[j], b: j + 1 }); j++; }
  const changed = ops.map((op, index) => (op.t === ' ' ? -1 : index)).filter((index) => index >= 0);
  if (!changed.length) return '';
  // hunks: the changes that are close enough share one
  const hunks = [];
  for (const index of changed) {
    const last = hunks[hunks.length - 1];
    if (last && index - last.end <= context * 2) last.end = index;
    else hunks.push({ start: index, end: index });
  }
  const out = [];
  for (const { start, end } of hunks) {
    const from = Math.max(0, start - context);
    const to = Math.min(ops.length - 1, end + context);
    const slice = ops.slice(from, to + 1);
    const oldStart = slice.find((op) => op.a)?.a ?? 0;
    const newStart = slice.find((op) => op.b)?.b ?? 0;
    const oldCount = slice.filter((op) => op.t !== '+').length;
    const newCount = slice.filter((op) => op.t !== '-').length;
    out.push(`@@ -${oldCount ? oldStart : oldStart - 1 < 0 ? 0 : oldStart},${oldCount} +${newCount ? newStart : 0},${newCount} @@`);
    for (const op of slice) out.push(`${op.t}${op.text}`);
  }
  return out.join('\n');
}
