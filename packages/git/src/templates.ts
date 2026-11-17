import type { GitProvider, Id, Template, TemplateKind } from './provider.js'

type Layout = { directories: Record<TemplateKind, string[]>, files: Record<TemplateKind, string[]> }

const LAYOUTS: Record<'gitlab' | 'github', Layout> = {
  gitlab: {
    directories: { issue: ['.gitlab/issue_templates/'], mergeRequest: ['.gitlab/merge_request_templates/'] },
    files: { issue: [], mergeRequest: [] }
  },
  github: {
    directories: { issue: ['.github/ISSUE_TEMPLATE/'], mergeRequest: ['.github/PULL_REQUEST_TEMPLATE/'] },
    files: { issue: ['.github/issue_template.md'], mergeRequest: ['.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md', 'docs/pull_request_template.md', 'pull_request_template.md'] }
  }
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

const stripFrontMatter = (text: string): { name: string | null, content: string } => {
  const match = FRONT_MATTER.exec(text)
  if (!match) return { name: null, content: text }
  const name = /^name:\s*['"]?(.+?)['"]?\s*$/m.exec(match[1] ?? '')?.[1] ?? null
  return { name, content: text.slice(match[0].length) }
}

const baseName = (file: string): string => (file.split('/').pop() ?? file).replace(/\.md$/i, '')

export const readRepositoryTemplates = async (
  provider: GitProvider,
  { token, id, kind, ref, host }: { token: string, id: Id, kind: TemplateKind, ref: string, host: 'gitlab' | 'github' }
): Promise<Template[]> => {
  const layout = LAYOUTS[host]
  const paths = await provider.listFiles({ token, id, ref })
  const lower = new Map(paths.map((file) => [file.toLowerCase(), file]))
  const wanted = [
    ...layout.files[kind].flatMap((file) => (lower.has(file.toLowerCase()) ? [lower.get(file.toLowerCase()) as string] : [])),
    ...paths.filter((file) => layout.directories[kind].some((directory) => file.startsWith(directory)) && /\.md$/i.test(file) && file.split('/').length === layout.directories[kind][0]!.split('/').length)
  ]
  const templates: Template[] = []
  for (const file of [...new Set(wanted)]) {
    const bytes = await provider.readFile({ token, id, path: file, ref })
    if (!bytes) continue
    const { name, content } = stripFrontMatter(bytes.toString('utf8'))
    const isDirectory = layout.directories[kind].some((directory) => file.startsWith(directory))
    templates.push({ name: name ?? (isDirectory ? baseName(file) : 'Default'), content })
  }
  return templates.sort((a, b) => a.name.localeCompare(b.name))
}
