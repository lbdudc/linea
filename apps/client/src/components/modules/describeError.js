/**
 * What went wrong in a call to the API, for people: the translated message, the detail the server gave (which manifest, which version...)
 * and, when the packages did not fit together, every diagnostic.
 */
export const describeError = (error, t) => {
  const data = error?.response?.data
  const key = data?.error
  const base = key ? t(key) : (error?.message ?? String(error))
  return {
    message: data?.detail ? `${base}: ${data.detail}` : base,
    diagnostics: Array.isArray(data?.diagnostics) ? data.diagnostics : [],
  }
}
