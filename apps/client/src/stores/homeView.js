import { reactive } from 'vue'

const STORAGE_KEY = 'linea-home-view'
export const HOME_VIEWS = ['all', 'inbox', 'panel']

const read = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return HOME_VIEWS.includes(stored) ? stored : 'all'
  } catch {
    return 'all'
  }
}

export const homeView = reactive({ view: read() })

export function setHomeView(view) {
  if (!HOME_VIEWS.includes(view)) return
  homeView.view = view
  try {
    localStorage.setItem(STORAGE_KEY, view)
  } catch {
    homeView.view = view
  }
}
