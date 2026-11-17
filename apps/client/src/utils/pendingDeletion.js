/** "23 days left": how far the day the host deletes something is. A day that is unknown or gone by says only that it waits. */
export const pendingDeletionLabel = (t, deletesOn) => {
  if (!deletesOn) return t('labels.pending_deletion')
  const days = Math.ceil((new Date(deletesOn).getTime() - Date.now()) / 86400000)
  if (days < 0) return t('labels.pending_deletion')
  if (days === 0) return t('labels.deletes_today')
  return days === 1 ? t('labels.deletes_one_day') : t('labels.deletes_days', { n: days })
}
