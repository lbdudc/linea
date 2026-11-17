const isPrimitive = (v) => v === null || typeof v !== 'object';
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Lists of strings (the features) are compared as sets; any other list as a whole, with its size.
function diffArrays(path, before, after, out) {
  if (same(before, after)) return;
  if (before.every(isPrimitive) && after.every(isPrimitive)) {
    for (const item of after) if (!before.includes(item)) out.push({ path, kind: 'added', after: item });
    for (const item of before) if (!after.includes(item)) out.push({ path, kind: 'removed', before: item });
    return;
  }
  out.push({ path, kind: 'changed', before: `${before.length}`, after: `${after.length}`, list: true });
}

function walk(path, before, after, out) {
  if (same(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) return diffArrays(path, before, after, out);
  if (isPlain(before) && isPlain(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      walk(path ? `${path}.${key}` : key, before[key], after[key], out);
    }
    return;
  }
  if (before === undefined) out.push({ path, kind: 'added', after });
  else if (after === undefined) out.push({ path, kind: 'removed', before });
  else out.push({ path, kind: 'changed', before, after });
}

/**
 * The differences between two specs, as a flat list: { path, kind: 'added' | 'removed' | 'changed', before?, after?, list? }.
 * `before` is what was generated, `after` what is saved.
 */
export function diffSpecs(before, after) {
  const out = [];
  walk('', before ?? {}, after ?? {}, out);
  return out;
}
