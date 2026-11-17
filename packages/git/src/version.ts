import fs from 'node:fs'

/** The version of this package (`package.json`), for health and diagnostics pages. */
export const version: string = (() => {
  try {
    const file = new URL('../package.json', import.meta.url)
    return (JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string }).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
})()
