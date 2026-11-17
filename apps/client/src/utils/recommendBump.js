import { diffSpecs } from './specDiff'

const isFeature = (change) => change.path === 'features' || change.path.startsWith('features.')

export function recommendBump(deployed, saved) {
  if (!deployed || !saved) return null
  const changes = diffSpecs(deployed, saved)
  if (!changes.length) return null
  const features = changes.filter(isFeature)
  const removed = features.filter((change) => change.kind === 'removed').length
  if (removed) return { bump: 'major', reason: 'features_removed', n: removed }
  const added = features.filter((change) => change.kind === 'added').length
  if (added) return { bump: 'minor', reason: 'features_added', n: added }
  return { bump: 'patch', reason: 'other', n: changes.length }
}
