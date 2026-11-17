import ToastEventBus from 'primevue/toasteventbus'

const SEVERITY = {
  positive: 'success',
  negative: 'error',
  warning: 'warn',
  info: 'info',
}

const GROUP = {
  top: 'top',
}

const DEFAULT_LIFE = 5000

export function notify({ type, message, position = 'bottom-right', timeout, action } = {}) {
  ToastEventBus.emit('add', {
    severity: SEVERITY[type] ?? 'info',
    detail: message,
    group: action ? 'accion' : GROUP[position],
    life: timeout === 0 ? undefined : (timeout ?? DEFAULT_LIFE),
    action,
  })
}

/** What to tell the person about a failed request: the server's own words, else its error code translated by `t`, else the error. */
export const errorMessage = (e, t) => e.response?.data?.detail ?? (e.response?.data?.error ? t(e.response.data.error) : e.message)

export function useNotify() {
  return { notify }
}
