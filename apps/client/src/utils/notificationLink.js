const TAB = { issue: 'issues', mr: 'mrs' }
const PARAM = { issue: 'issue', mr: 'mr' }

export const notificationLink = (notification) => {
  const { kind, id } = notification.target
  const base = kind === 'product' ? `/products/${id}` : `/lines/${id}`
  return `${base}?tab=${TAB[notification.subject]}&${PARAM[notification.subject]}=${notification.number}`
}
