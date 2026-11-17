// Which view of an SPL's modules the user last used (the graph or the list), kept in the browser: a convenience, so every
// access is guarded and a browser without storage just gets the default.
const KEY = 'linea.modules.view'
const VIEWS = ['graph', 'list']

export const readView = () => {
  try {
    const stored = window.localStorage.getItem(KEY)
    return VIEWS.includes(stored) ? stored : 'list'
  } catch {
    return 'list'
  }
}

export const writeView = (view) => {
  try {
    window.localStorage.setItem(KEY, view)
  } catch {
    // no storage: the choice lasts until the page is left
  }
}
