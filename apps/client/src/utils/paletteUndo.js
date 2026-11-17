const KEY = 'linea.palette.undo'

export function rememberLanguageUndo(previous) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ kind: 'language', previous }))
  } catch {
    return
  }
}

export function takeLanguageUndo() {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY))
    sessionStorage.removeItem(KEY)
    return value?.kind === 'language' && typeof value.previous === 'string' ? value.previous : null
  } catch {
    return null
  }
}
