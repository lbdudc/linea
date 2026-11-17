import type { FileDiff } from '../provider.js'

/** The files of the output of `git diff -M`: each with its status, the counts and the patch from the first hunk on. */
export const parseGitDiff = (text: string): FileDiff[] => {
  const files: FileDiff[] = []
  for (const block of text.split(/^diff --git /m).slice(1)) {
    const lines = block.split('\n')
    const [, oldHead = '', newHead = ''] = /^a\/(.*) b\/(.*)$/.exec(lines[0] ?? '') ?? []
    let status: FileDiff['status'] = 'modified'
    let oldPath = oldHead
    let newPath = newHead
    let start = lines.length
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? ''
      if (line.startsWith('@@')) { start = i; break }
      if (line.startsWith('new file mode')) status = 'added'
      else if (line.startsWith('deleted file mode')) status = 'deleted'
      else if (line.startsWith('rename from ')) { status = 'renamed'; oldPath = line.slice(12) }
      else if (line.startsWith('rename to ')) newPath = line.slice(10)
    }
    const patchLines = lines.slice(start)
    while (patchLines.length && patchLines[patchLines.length - 1] === '') patchLines.pop()
    let additions = 0
    let deletions = 0
    for (const line of patchLines) {
      if (line.startsWith('+')) additions += 1
      else if (line.startsWith('-')) deletions += 1
    }
    files.push({ oldPath, newPath, status, additions, deletions, patch: patchLines.join('\n') })
  }
  return files
}
