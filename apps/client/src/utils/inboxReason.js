export function reasonText(reason, t) {
  switch (reason.key) {
    case 'generation': return t('home.reason_generation')
    case 'pipeline': return t('home.reason_pipeline')
    case 'invalid': return reason.errorType ?? t('home.reason_invalid')
    case 'conflict': return reason.iid ? t('home.reason_conflict', { n: reason.iid }) : t('home.reason_conflicts', { n: reason.count })
    case 'deploy': return t('home.reason_deploy', { version: reason.version })
    case 'stale': return t('home.reason_stale', { n: reason.days })
    default: return reason.key
  }
}
