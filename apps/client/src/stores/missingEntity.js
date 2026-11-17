import { reactive } from 'vue'

// The page of a line, a product or a package whose id the server does not know (404): the shell shows "not found" instead of
// an empty page. Kept apart from the HTTP layer so it can say "this one is missing" without importing the components.

export const missingEntity = reactive({ path: null, kind: 'not_found' })

/** Whether a failed request is the 404 of the very thing the page at `route` is about (its id is in the request's path). */
export const isMissingEntityResponse = ({ status, url }, route) => {
  const id = route?.params?.id
  if (status !== 404 || !id || typeof url !== 'string') return false
  return url.split('?')[0].split('/').includes(encodeURIComponent(String(id)))
}

export const isForbiddenEntityResponse = ({ status, url }, route) => {
  const id = route?.params?.id
  if (status !== 403 || !id || typeof url !== 'string') return false
  return url.split('?')[0].split('/').includes(encodeURIComponent(String(id)))
}

export const markMissing = (path, kind = 'not_found') => { missingEntity.path = path; missingEntity.kind = kind }
export const clearMissing = () => { missingEntity.path = null; missingEntity.kind = 'not_found' }
