import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'

/**
 * Metrics of generated code. The annotated code of an SPL cannot be measured as it is (it is not valid code until it is derived), so what is
 * measured is the products the SPL derives, with lizard (cyclomatic complexity, lines, parameters, per function).
 */

/** A line of lizard's `--csv`: NLOC,CCN,tokens,params,length,"name@start-end@file","file","name","long name",start,end */
const parseCsvLine = (line) => {
  const fields = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { current += '"'; i++ } else if (char === '"') quoted = false
      else current += char
    } else if (char === '"') quoted = true
    else if (char === ',') { fields.push(current); current = '' } else current += char
  }
  fields.push(current)
  return fields
}

export const parseLizardCsv = ({ csv, root }) =>
  csv.split('\n').filter((line) => line.trim() !== '').map((line) => {
    const [nloc, ccn, , params, length, , file, name, longName, start, end] = parseCsvLine(line)
    const relative = root !== undefined && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file
    return { file: relative, name, longName, ccn: Number(ccn), nloc: Number(nloc), params: Number(params), length: Number(length), start: Number(start), end: Number(end) }
  })

const lizard = () => {
  const [command, ...args] = (process.env.LINEA_CI_LIZARD ?? 'lizard').split(' ')
  return { command, args }
}

/** The functions of a directory with their metrics (paths relative to it). */
export const measure = ({ dir, exclude = ['*/node_modules/*', '*/.git/*', '*/build/*', '*/dist/*', '*/.gradle/*'] }) => {
  const { command, args } = lizard()
  let csv
  try {
    csv = execFileSync(command, [...args, '--csv', ...exclude.flatMap((pattern) => ['-x', pattern]), '.'], { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('lizard is not installed: `pip install lizard` (or set LINEA_CI_LIZARD to the command that runs it).')
    throw error
  }
  return parseLizardCsv({ csv, root: '.' }).map((fn) => ({ ...fn, file: fn.file.replace(/^\.\//, '') }))
}

const keyOf = (fn) => `${fn.file}::${fn.longName || fn.name}`

export const totals = (functions) => ({
  functions: functions.length,
  nloc: functions.reduce((sum, fn) => sum + fn.nloc, 0),
  ccn: functions.reduce((sum, fn) => sum + fn.ccn, 0),
  maxCcn: functions.reduce((max, fn) => Math.max(max, fn.ccn), 0)
})

/** What changed between two measurements of a product: functions added, removed, and the ones whose complexity moved. */
export const compare = ({ base, head }) => {
  if (base === undefined) return { added: [], removed: [], changed: [], base: undefined, head: totals(head) }
  const before = new Map(base.map((fn) => [keyOf(fn), fn]))
  const after = new Map(head.map((fn) => [keyOf(fn), fn]))
  return {
    added: head.filter((fn) => !before.has(keyOf(fn))),
    removed: base.filter((fn) => !after.has(keyOf(fn))),
    changed: head.filter((fn) => before.has(keyOf(fn)) && before.get(keyOf(fn)).ccn !== fn.ccn).map((fn) => ({ ...fn, previous: before.get(keyOf(fn)).ccn })),
    base: totals(base),
    head: totals(head)
  }
}

/** What a feature brings: the functions that are in the product with it and not without it. */
export const attribution = ({ full, without }) => {
  const absent = new Set(without.map(keyOf))
  const brought = full.filter((fn) => !absent.has(keyOf(fn)))
  // the functions both have, but that got more complex with the feature (a branch the feature adds to shared code)
  const shared = new Map(without.map((fn) => [keyOf(fn), fn]))
  const grown = full.filter((fn) => shared.has(keyOf(fn)) && fn.ccn > shared.get(keyOf(fn)).ccn)
  return {
    functions: brought.length,
    nloc: brought.reduce((sum, fn) => sum + fn.nloc, 0),
    ccn: brought.reduce((sum, fn) => sum + fn.ccn, 0) + grown.reduce((sum, fn) => sum + fn.ccn - shared.get(keyOf(fn)).ccn, 0),
    maxCcn: brought.reduce((max, fn) => Math.max(max, fn.ccn), 0),
    grown: grown.length
  }
}

const signed = (n) => (n > 0 ? `+${n}` : `${n}`)

export const renderMarkdown = ({ products, attributions, threshold }) => {
  const lines = ['<!-- linea-ci:metrics -->', '### Complexity of the products this change derives', '']
  if (products.length === 0) return [...lines, 'No product is affected by this change.', ''].join('\n')
  lines.push('| Product | Functions | NLOC | CCN (total) | Max CCN | Over ' + threshold + ' |', '|---|---|---|---|---|---|')
  for (const { name, comparison, over } of products) {
    const { base, head } = comparison
    const delta = (key) => (base === undefined ? '' : ` (${signed(head[key] - base[key])})`)
    lines.push(`| ${name} | ${head.functions}${delta('functions')} | ${head.nloc}${delta('nloc')} | ${head.ccn}${delta('ccn')} | ${head.maxCcn}${delta('maxCcn')} | ${over.length} |`)
  }
  const worse = products.flatMap(({ name, comparison }) => [
    ...comparison.added.map((fn) => ({ name, fn, kind: 'new', ccn: fn.ccn })),
    ...comparison.changed.filter((fn) => fn.ccn > fn.previous).map((fn) => ({ name, fn, kind: `was ${fn.previous}`, ccn: fn.ccn }))
  ]).sort((a, b) => b.ccn - a.ccn).slice(0, 10)
  if (worse.length > 0) {
    lines.push('', '**Most complex new or grown functions**', '', '| Product | Function | CCN | |', '|---|---|---|---|')
    for (const { name, fn, kind } of worse) lines.push(`| ${name} | \`${fn.file}\` ${fn.name} | ${fn.ccn} | ${kind} |`)
  }
  if (attributions.length > 0) {
    lines.push('', '**What each touched feature brings** (the product derived with it, against without it)', '', '| Feature | Measured on | Functions | NLOC | CCN | Max CCN |', '|---|---|---|---|---|---|')
    for (const { feature, product, result } of attributions) {
      lines.push(result === undefined
        ? `| ${feature} | ${product ?? '-'} | n/a: no valid product can be derived without it | | | |`
        : `| ${feature} | ${product} | ${result.functions} | ${result.nloc} | ${result.ccn} | ${result.maxCcn} |`)
    }
  }
  return [...lines, ''].join('\n')
}

/** GitLab's Code Quality report: one issue per function over the threshold (shown in the merge request widget). */
export const codeQualityReport = ({ products, threshold }) =>
  products.flatMap(({ name, over }) =>
    over.map((fn) => ({
      description: `${fn.name} has a cyclomatic complexity of ${fn.ccn} (limit ${threshold}) in product ${name}`,
      check_name: 'linea-ci/cyclomatic-complexity',
      fingerprint: crypto.createHash('sha1').update(`${name}:${keyOf(fn)}`).digest('hex'),
      severity: fn.ccn > threshold * 2 ? 'major' : 'minor',
      location: { path: fn.file, lines: { begin: fn.start } }
    })))
