/** What changes in a product if its feature selection becomes `wanted`: the features it gains and the ones it loses. */
export const selectionDiff = (current = [], wanted = []) => {
  const has = new Set(current)
  const want = new Set(wanted)
  const added = [...want].filter((feature) => !has.has(feature)).sort()
  const removed = [...has].filter((feature) => !want.has(feature)).sort()
  return { added, removed, same: !added.length && !removed.length }
}
