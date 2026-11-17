/** Orders `X.Y.Z` versions the way a person reads them (1.10.0 comes after 1.9.0): oldest first. */
export const compareVersions = (a, b) => {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}
