const PARTS = { major: 0, minor: 1, patch: 2 };

// The X.Y.Z that raising `bump` ('major' | 'minor' | 'patch') gives: the parts after it go back to 0.
// Mirrors incrementVersion in linea-core, which is what the server really applies.
export function bumpVersion(version, bump = 'patch') {
  const parts = String(version || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  const index = PARTS[bump] ?? PARTS.patch;
  parts[index] += 1;
  for (let i = index + 1; i < 3; i++) parts[i] = 0;
  return parts.slice(0, 3).join('.');
}
