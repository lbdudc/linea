import fs from 'node:fs'
import path from 'node:path'

/** Keeps a generated file out of `git status` of a checkout, without touching its tracked `.gitignore`. */
export function excludeFromGit (repoDir: string, pattern: string): void {
  const exclude = path.join(repoDir, '.git', 'info', 'exclude')
  try {
    if (!fs.statSync(path.join(repoDir, '.git')).isDirectory()) return
  } catch {
    return
  }
  fs.mkdirSync(path.dirname(exclude), { recursive: true })
  const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : ''
  if (current.split(/\r?\n/).includes(pattern)) return
  fs.writeFileSync(exclude, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${pattern}\n`)
}
