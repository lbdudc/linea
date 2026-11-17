import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  ablateFeature,
  activateFeature,
  analyzeAnnotations,
  completeSelection,
  parseUvl,
  checkLeftovers,
  DEFAULT_PLATFORM_CONFIG,
  deriveProduct,
  diffDirectories,
  formatDirectory,
  pairwiseSelections,
  readProductsIndex,
  readTextFile,
  renderChildPipeline,
  resolveLinePaths,
  selectProducts,
  validateProductSelections,
  writeTextFile
} from '@lbdudc/linea-core'
import { attribution, codeQualityReport, compare, measure, renderMarkdown, totals } from './metrics.mjs'
import { deriveModular, isModularLine, platformOf, readModels } from './modular.mjs'

const USAGE = `Usage: linea-ci <command> [options]

  check-leftovers <productDir> [--line <lineDir>] [--allow <path>,...]
      Fails if annotation delimiters survived in a derived product. Delimiters are the ones of the line
      (config.json), or the default ones of a new line when there is no --line (inside a product repo).
  validate-specs --line <lineDir> <spec.json | folder>...
      Checks each product's feature selection against the feature model of the line.
  derive --line <lineDir> --spec <spec.json> --out <dir> [--models <dir>]
      Derives a product from the line. A line made of modules also needs the models of the product (--models;
      by default <spec without .json>.models, where fetch-specs puts them), and --server and a token to read its modules.
  fetch-specs --line <lineDir> --out <dir> [--token <token>] [--server <url>]
      Reads .linea/spec.json of each product of products.json into <dir>/<name>.json: through the GitLab API for a
      GitLab project, by cloning for a git remote or a folder.
      A repositorio that is a path in the server (linea/spls/X/p/p) is resolved against --server or $CI_SERVER_URL.
  sample-configs --line <lineDir> --specs <dir> --out <dir> [--max <n>] [--pipeline-out <file>]
      Writes specs for a pairwise sample of the line's configurations (every pair of features together once), made from the
      smallest real product, so they can be derived and tested like real ones.
  check-drift --line <lineDir> --spec <spec.json> (--product <dir> | --repository <path in the server | url>)
      Derives the product from the line and fails if what is committed in the product differs from it (not counting .linea/
      and files the product has that the line does not generate).
  check-version --line <lineDir> --base-line <dir>
      Fails if features were removed from the feature model and the version in spl.json was not raised.
  release-products --linea-url <url> --line <name> [--bump patch|minor|major]
      Asks LINEA ($LINEA_TOKEN: a session token) to generate again every product of the line.
  check-determinism --line <lineDir> --spec <spec.json>
      Derives the product twice and fails if the two results differ.
  metrics <dir> [--max-ccn <n>]
      Cyclomatic complexity of a derived product (lizard); with --max-ccn, fails when a function is over it.
  mr-metrics --line <lineDir> --specs <dir> --selection <selection.json> --out <dir> [--base-line <dir>] [--max-ccn <n>]
      Derives the selected products from the proposed code (and from --base-line, the target branch), measures them, and
      writes metrics.md, metrics.json and gl-code-quality-report.json. For each touched feature it measures what the
      feature brings by deriving a product with and without it.
  mr-note <file.md> [--marker <text>]
      Posts the file as a note of the merge request ($CI_API_V4_URL, $CI_PROJECT_ID, $CI_MERGE_REQUEST_IID), or updates the
      note that already has the marker (the first line of the file by default).
  commit-lint [--title <text>] [--base <sha> --head <sha>] [--strict]   (--base/--head: commit SHAs only)
      Checks that the commits of the range (and the merge request title, $CI_MERGE_REQUEST_TITLE by default) follow Conventional
      Commits (type(scope)!: description). Only warns (exit 0) unless --strict; with squash merge the title is the commit.
  release-tag --line <lineDir> [--project <id|path>] [--ref <sha>] [--prefix v] [--dry-run]
      On main, after the version of spl.json was raised: if the tag v<version> has no tag and no release in the project
      ($CI_PROJECT_ID), creates both, with the notes written by the changelog generator of linea-git (sections such as «Features»...).
      Does nothing when the tag or the release already exist (LINEA made them, or the job ran before).
  select-products --line <lineDir> --specs <dir> (--base <sha> --head <sha> | --changed <file>,...)
                  [--max <n>] [--baseline <n>] [--with-drift] [--pipeline-out <file>] [--tags a,b]
      Picks the products a change can break; with --pipeline-out writes the child pipeline that checks them.
`

const OPTIONS = {
  line: { type: 'string' },
  spec: { type: 'string' },
  specs: { type: 'string' },
  out: { type: 'string' },
  allow: { type: 'string' },
  base: { type: 'string' },
  head: { type: 'string' },
  changed: { type: 'string' },
  max: { type: 'string' },
  baseline: { type: 'string' },
  'pipeline-out': { type: 'string' },
  token: { type: 'string' },
  server: { type: 'string' },
  models: { type: 'string' },
  selection: { type: 'string' },
  'base-line': { type: 'string' },
  'max-ccn': { type: 'string' },
  marker: { type: 'string' },
  product: { type: 'string' },
  repository: { type: 'string' },
  max: { type: 'string' },
  'linea-url': { type: 'string' },
  bump: { type: 'string' },
  'with-drift': { type: 'boolean' },
  tags: { type: 'string' },
  title: { type: 'string' },
  strict: { type: 'boolean' },
  project: { type: 'string' },
  ref: { type: 'string' },
  prefix: { type: 'string' },
  'dry-run': { type: 'boolean' }
}

/** `--tags a,b` (or LINEA_CI_TAGS): the runner tags the child pipeline's jobs ask for. */
const tagsOf = (values) => {
  const given = values.tags ?? process.env.LINEA_CI_TAGS ?? ''
  const tags = given.split(',').map((tag) => tag.trim()).filter(Boolean)
  return tags.length ? { tags } : {}
}

/** A spec file is either the spec itself or `{ spec }`, as `.linea/spec.json` of a product has it. */
const readSpec = (file) => {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  const spec = parsed.spec !== undefined && typeof parsed.spec === 'object' ? parsed.spec : parsed
  return { name: spec.basicData?.name ?? path.basename(file, '.json'), spec }
}

const selectionOf = (file) => {
  const { spec } = readSpec(file)
  const { features } = spec
  return {
    // the name the line knows the product by (products.json), which is what fetch-specs names the file after
    name: path.basename(file, '.json'),
    features: Array.isArray(features)
      ? features
      : Object.entries(features ?? {}).filter(([, on]) => on).map(([feature]) => feature)
  }
}

const csv = (value) => (value ?? '').split(',').map((part) => part.trim()).filter((part) => part !== '')

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** Where a product repository is: a GitLab project (a URL or a path in the server, read through the API) or a git remote or folder (cloned). */
const locate = (repositorio, server) => {
  if (/^https?:\/\//i.test(repositorio)) {
    const url = new URL(repositorio)
    return { api: { server: url.origin, project: url.pathname.replace(/^\/|\.git$|\/$/g, '') } }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(repositorio) || path.isAbsolute(repositorio)) return { clone: repositorio }
  if (server === undefined) throw new Error(`"${repositorio}" is a path in the git server: give --server or set CI_SERVER_URL`)
  return { api: { server: server.replace(/\/$/, ''), project: repositorio.replace(/\.git$/, '') } }
}

/** The `.linea/spec.json` of a product and its `.linea/models/*` (`{ file: text }`), from the default branch of its GitLab project. */
const specFromApi = async ({ server, project }, token) => {
  const headers = token !== undefined ? { 'PRIVATE-TOKEN': token } : process.env.CI_JOB_TOKEN !== undefined ? { 'JOB-TOKEN': process.env.CI_JOB_TOKEN } : {}
  const base = `${server}/api/v4/projects/${encodeURIComponent(project)}`
  const get = async (url, what) => {
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`${res.status} reading ${what} of ${project}`)
    return res
  }
  const { default_branch: ref } = await (await get(base, 'the project')).json()
  const raw = (file) => get(`${base}/repository/files/${encodeURIComponent(file)}/raw?ref=${encodeURIComponent(ref)}`, file).then((res) => res.text())
  const spec = await raw('.linea/spec.json')
  const models = {}
  const listing = await fetch(`${base}/repository/tree?path=${encodeURIComponent('.linea/models')}&ref=${encodeURIComponent(ref)}&per_page=100`, { headers })
  if (listing.ok) {
    for (const entry of await listing.json()) if (entry.type === 'blob') models[entry.name] = await raw(`.linea/models/${entry.name}`)
  }
  return { spec, models }
}

const specFromClone = (remote, cwd) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-ci-'))
  try {
    git(['clone', '--quiet', '--depth', '1', remote, tmp], cwd)
    const modelsDir = path.join(tmp, '.linea', 'models')
    return {
      spec: fs.readFileSync(path.join(tmp, '.linea', 'spec.json'), 'utf8'),
      models: fs.existsSync(modelsDir) ? Object.fromEntries(fs.readdirSync(modelsDir).map((file) => [file, fs.readFileSync(path.join(modelsDir, file), 'utf8')])) : {}
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/** Derives a product of a line into `outputDir`: through the platform of the line, or composed from its modules. `features` replaces the selection. */
const deriveInto = async ({ line, specFile, outputDir, server, token, features, root }) => {
  const { spec: original } = readSpec(specFile)
  const spec = features === undefined ? original : { ...original, features }
  if (isModularLine(line)) {
    const modelsDir = specFile.replace(/\.json$/, '.models')
    if (!fs.existsSync(modelsDir)) throw new Error(`The line is made of modules: the models of the product are needed (${modelsDir} does not exist).`)
    const models = readModels(modelsDir)
    // in a line made of modules the features of a product are the ones of its selection model: a different selection is a different model
    if (features !== undefined) {
      if (root === undefined) throw new Error('The root feature of the line is needed to write another selection.')
      models.featureselection = selectionModel(root, features)
    }
    await deriveModular({ lineDir: line, spec, models, outputDir, server, token })
  } else {
    await deriveProduct({ lineDir: line, spec, outputDir })
  }
}

/** The tree of the feature model of a line (composed from its modules when it is made of them). */
const treeOf = async ({ line, scratch, server, token }) => {
  const platform = await platformOf({ lineDir: line, scratch, server, token })
  return parseUvl({ content: readTextFile({ filePath: resolveLinePaths({ lineDir: platform }).model }) })
}

const postNote = async ({ body, marker }) => {
  const { CI_API_V4_URL: api, CI_PROJECT_ID: project, CI_MERGE_REQUEST_IID: iid } = process.env
  const token = process.env.LINEA_CI_TOKEN
  if (api === undefined || project === undefined || iid === undefined) throw new Error('mr-note runs in a merge request pipeline: CI_API_V4_URL, CI_PROJECT_ID and CI_MERGE_REQUEST_IID are not all set.')
  if (token === undefined) throw new Error('mr-note needs LINEA_CI_TOKEN (a token that can comment on the merge request).')
  const headers = { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' }
  const notes = `${api}/projects/${encodeURIComponent(project)}/merge_requests/${iid}/notes`
  const listing = await fetch(`${notes}?per_page=100`, { headers })
  if (!listing.ok) throw new Error(`${listing.status} listing the notes of the merge request`)
  const existing = (await listing.json()).find((note) => typeof note.body === 'string' && note.body.includes(marker))
  const res = await fetch(existing === undefined ? notes : `${notes}/${existing.id}`, { method: existing === undefined ? 'POST' : 'PUT', headers, body: JSON.stringify({ body }) })
  if (!res.ok) throw new Error(`${res.status} writing the note`)
  return existing === undefined ? 'created' : 'updated'
}

/** Conventional Commits: type(scope)!: description. The types are those of the changelog of linea-git plus the usual ones. */
const COMMIT_TYPES = ['feat', 'fix', 'perf', 'refactor', 'docs', 'chore', 'ci', 'test', 'build', 'style', 'revert']
const CONVENTIONAL = new RegExp(`^(${COMMIT_TYPES.join('|')})(\\([^)\\r\\n]+\\))?!?: \\S`)
/** Titles nobody writes by hand: merges, reverts and fixups are not linted. */
const EXEMPT = /^(Merge |Revert "|fixup! |squash! )/
export const lintTitle = (title) => {
  const text = title.trim().replace(/^(Draft|WIP):\s*/i, '')
  return EXEMPT.test(text) || CONVENTIONAL.test(text)
}
/** Messages are data from whoever can push: control characters (ANSI sequences) are dropped before they reach the job log. */
const printable = (text) => text.replace(/[\x00-\x1f\x7f]/g, ' ')
const SAFE_REF = /^[0-9a-fA-F]{7,64}$/

const semverParts = (version) => String(version).split('.').map((part) => Number.parseInt(part, 10) || 0)
const semverGreater = (a, b) => {
  const [x, y] = [semverParts(a), semverParts(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

/** The files of a product repository (default branch) written under `dir`: through the GitLab API, or by cloning. */
const fetchTree = async ({ repositorio, dir, server, token, cwd }) => {
  const where = locate(repositorio, server)
  if (where.api === undefined) {
    git(['clone', '--quiet', '--depth', '1', where.clone, dir], cwd)
    return
  }
  const headers = token !== undefined ? { 'PRIVATE-TOKEN': token } : process.env.CI_JOB_TOKEN !== undefined ? { 'JOB-TOKEN': process.env.CI_JOB_TOKEN } : {}
  const base = `${where.api.server}/api/v4/projects/${encodeURIComponent(where.api.project)}`
  const get = async (url) => {
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`${res.status} reading ${url}`)
    return res
  }
  const { default_branch: ref } = await (await get(base)).json()
  for (let page = 1; ; page++) {
    const entries = await (await get(`${base}/repository/tree?recursive=true&per_page=100&page=${page}&ref=${encodeURIComponent(ref)}`)).json()
    for (const entry of entries.filter(({ type }) => type === 'blob')) {
      const raw = Buffer.from(await (await get(`${base}/repository/files/${encodeURIComponent(entry.path)}/raw?ref=${encodeURIComponent(ref)}`)).arrayBuffer())
      fs.mkdirSync(path.dirname(path.join(dir, entry.path)), { recursive: true })
      fs.writeFileSync(path.join(dir, entry.path), raw)
    }
    if (entries.length < 100) break
  }
}

const listFilesIn = (dir) => {
  const found = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else found.push(path.relative(dir, full).split(path.sep).join('/'))
    }
  }
  walk(dir)
  return found.sort()
}

const selectionModel = (root, features) => `selection of ${root} {\n${features.filter((name) => name !== root).map((name) => `  select ${name}\n`).join('')}}\n`

/** Runs a `linea-ci` command line and returns its exit code: 0 ok, 1 the check found problems or failed, 2 used wrong. */
export const runCi = async ({ argv, io, cwd = process.cwd(), deps = {} }) => {
  const [command, ...rest] = argv
  let parsed
  try {
    parsed = parseArgs({ args: rest, options: OPTIONS, allowPositionals: true })
  } catch (error) {
    io.err(`${error.message}\n${USAGE}`)
    return 2
  }
  const { values, positionals } = parsed
  const line = values.line === undefined ? undefined : path.resolve(cwd, values.line)
  const server = values.server ?? process.env.CI_SERVER_URL
  const token = values.token ?? process.env.LINEA_CI_TOKEN
  let scratch
  const scratchDir = () => (scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), 'linea-ci-')))
  const missing = (...flags) => {
    const absent = flags.filter((flag) => values[flag] === undefined)
    if (absent.length > 0) io.err(`Missing ${absent.map((flag) => `--${flag}`).join(', ')}\n${USAGE}`)
    return absent.length > 0
  }

  try {
    switch (command) {
      case 'check-leftovers': {
        const [dir] = positionals
        if (dir === undefined) { io.err(USAGE); return 2 }
        // a line made of modules keeps no config.json in its repository: the default delimiters are the ones it is composed with
        const configFile = line === undefined ? undefined : resolveLinePaths({ lineDir: line }).config
        const config = configFile !== undefined && fs.existsSync(configFile) ? JSON.parse(readTextFile({ filePath: configFile })) : DEFAULT_PLATFORM_CONFIG
        const found = checkLeftovers({ productDir: path.resolve(cwd, dir), config, exclude: csv(values.allow) })
        if (found.length === 0) { io.out('No annotation left in the product.\n'); return 0 }
        io.err(`${found.length} annotation delimiter(s) left in the derived product:\n${found.map((hit) => `  ${hit.file}:${hit.line}  ${hit.delimiter}`).join('\n')}\n`)
        return 1
      }
      case 'validate-specs': {
        if (positionals.length === 0 || missing('line')) return 2
        // a folder stands for the specs in it (an SPL with no products has an empty one)
        const files = positionals.flatMap((entry) => {
          const full = path.resolve(cwd, entry)
          return fs.existsSync(full) && fs.statSync(full).isDirectory()
            ? fs.readdirSync(full).filter((file) => file.endsWith('.json')).sort().map((file) => path.join(full, file))
            : [full]
        })
        if (files.length === 0) { io.out('No product to validate.\n'); return 0 }
        const platform = await platformOf({ lineDir: line, scratch: scratchDir(), server, token })
        const featureModel = readTextFile({ filePath: resolveLinePaths({ lineDir: platform }).model })
        const reports = validateProductSelections({ featureModel, products: files.map((file) => selectionOf(file)) })
        let bad = 0
        for (const { name, problems } of reports) {
          if (problems.length === 0) { io.out(`ok   ${name}\n`); continue }
          bad++
          io.err(`FAIL ${name}\n${problems.map(({ message }) => `       ${message}`).join('\n')}\n`)
        }
        return bad === 0 ? 0 : 1
      }
      case 'derive': {
        if (missing('line', 'spec', 'out')) return 2
        const specFile = path.resolve(cwd, values.spec)
        const outputDir = path.resolve(cwd, values.out)
        if (values.models !== undefined) {
          // models in another place than next to the spec: link them where the helper looks
          const target = specFile.replace(/\.json$/, '.models')
          if (!fs.existsSync(target)) fs.cpSync(path.resolve(cwd, values.models), target, { recursive: true })
        }
        await deriveInto({ line, specFile, outputDir, server, token })
        io.out(`Derived into ${outputDir}\n`)
        return 0
      }
      case 'sample-configs': {
        if (missing('line', 'specs', 'out')) return 2
        const specsDir = path.resolve(cwd, values.specs)
        const out = path.resolve(cwd, values.out)
        const tree = await treeOf({ line, scratch: scratchDir(), server, token })
        const templates = fs.existsSync(specsDir) ? fs.readdirSync(specsDir).filter((file) => file.endsWith('.json')).map((file) => file.replace(/\.json$/, '')) : []
        if (templates.length === 0) throw new Error('A real product is needed to make the samples from: none was found in the specs folder.')
        const size = (name) => completeSelection({ tree, features: readSpec(path.join(specsDir, `${name}.json`)).spec.features }).size
        const [template] = templates.sort((a, b) => size(a) - size(b) || a.localeCompare(b))
        const templateFile = path.join(specsDir, `${template}.json`)
        const { spec } = readSpec(templateFile)
        const samples = pairwiseSelections({ tree, base: [tree.root.name], max: values.max === undefined ? 50 : Number(values.max) })
        fs.mkdirSync(out, { recursive: true })
        const names = samples.map((features, index) => {
          const name = `pairwise-${index + 1}`
          fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify({ spec: { ...spec, basicData: { ...spec.basicData, name }, features } }, null, 2))
          const models = templateFile.replace(/\.json$/, '.models')
          if (fs.existsSync(models)) {
            fs.cpSync(models, path.join(out, `${name}.models`), { recursive: true })
            const selectionFile = fs.readdirSync(path.join(out, `${name}.models`)).find((file) => file.startsWith('featureselection.'))
            if (selectionFile !== undefined) fs.writeFileSync(path.join(out, `${name}.models`, selectionFile), selectionModel(tree.root.name, features))
          }
          return name
        })
        if (values['pipeline-out'] !== undefined) {
          writeTextFile({ filePath: path.resolve(cwd, values['pipeline-out']), content: renderChildPipeline({ products: names, specsDir: path.relative(line, out) || '.', parentJob: 'sample', ...tagsOf(values) }) })
        }
        io.out(`${JSON.stringify({ template, samples: names }, null, 2)}\n`)
        return 0
      }
      case 'check-drift': {
        if (missing('line', 'spec')) return 2
        if (values.product === undefined && values.repository === undefined) { io.err(`Give --product or --repository\n${USAGE}`); return 2 }
        const specFile = path.resolve(cwd, values.spec)
        const derived = path.join(scratchDir(), 'derived')
        await deriveInto({ line, specFile, outputDir: derived, server, token, root: undefined })
        // LINEA formats what it generates before committing it
        await formatDirectory({ dir: derived })
        let productDir
        if (values.product !== undefined) productDir = path.resolve(cwd, values.product)
        else {
          productDir = path.join(scratchDir(), 'product')
          fs.mkdirSync(productDir)
          await fetchTree({ repositorio: values.repository, dir: productDir, server, token, cwd })
        }
        const drifted = []
        for (const file of listFilesIn(derived)) {
          if (file.startsWith('.linea/')) continue
          const there = path.join(productDir, file)
          if (!fs.existsSync(there)) drifted.push(`missing ${file}`)
          else if (!fs.readFileSync(there).equals(fs.readFileSync(path.join(derived, file)))) drifted.push(`changed ${file}`)
        }
        if (drifted.length === 0) { io.out('The product is what the line generates.\n'); return 0 }
        io.err(`The product differs from what the line generates in ${drifted.length} file(s):\n${drifted.map((entry) => `  ${entry}`).join('\n')}\n`)
        return 1
      }
      case 'check-version': {
        if (missing('line', 'base-line')) return 2
        const baseLine = path.resolve(cwd, values['base-line'])
        const manifestOf = (dir) => (fs.existsSync(path.join(dir, 'spl.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'spl.json'), 'utf8')) : undefined)
        const [head, base] = [manifestOf(line), manifestOf(baseLine)]
        if (head === undefined || base === undefined) { io.out('The line has no spl.json: there is no version to check.\n'); return 0 }
        const collectNames = (node) => [node.name, ...node.groups.flatMap((group) => group.features.flatMap(collectNames))]
        const namesOf = (tree) => new Set(collectNames(tree.root))
        const [headTree, baseTree] = [await treeOf({ line, scratch: scratchDir(), server, token }), await treeOf({ line: baseLine, scratch: path.join(scratchDir(), 'base'), server, token })]
        const now = namesOf(headTree)
        const removed = [...namesOf(baseTree)].filter((name) => !now.has(name))
        if (removed.length === 0) { io.out('No feature was removed.\n'); return 0 }
        if (semverGreater(head.version, base.version)) { io.out(`Features removed (${removed.join(', ')}) and the version went from ${base.version} to ${head.version}.\n`); return 0 }
        io.err(`Features were removed (${removed.join(', ')}) but the version of the line is still ${head.version}: raise it in spl.json (products that select them stop being valid).\n`)
        return 1
      }
      case 'release-products': {
        if (missing('linea-url', 'line')) return 2
        const base = values['linea-url'].replace(/\/$/, '')
        const session = process.env.LINEA_TOKEN
        if (session === undefined) throw new Error('release-products needs LINEA_TOKEN (a LINEA session token).')
        const headers = { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' }
        const listing = await fetch(`${base}/api/products/enrolled`, { headers })
        if (!listing.ok) throw new Error(`${listing.status} listing the products on LINEA`)
        const products = (await listing.json()).filter((product) => product.line === values.line)
        if (products.length === 0) { io.out(`No product of ${values.line} on LINEA.\n`); return 0 }
        let failed = 0
        for (const product of products) {
          const res = await fetch(`${base}/api/products/${product._id}/generate`, { method: 'POST', headers, body: JSON.stringify(values.bump === undefined ? {} : { bump: values.bump }) })
          if (res.ok) io.out(`generated ${product.name}\n`)
          else { failed++; io.err(`could not generate ${product.name}: ${res.status}\n`) }
        }
        return failed === 0 ? 0 : 1
      }
      case 'check-determinism': {
        if (missing('line', 'spec')) return 2
        const specFile = path.resolve(cwd, values.spec)
        const [first, second] = [path.join(scratchDir(), 'first'), path.join(scratchDir(), 'second')]
        await deriveInto({ line, specFile, outputDir: first, server, token })
        await deriveInto({ line, specFile, outputDir: second, server, token })
        const changes = diffDirectories({ oldDir: first, newDir: second })
        if (changes.length === 0) { io.out('Two derivations gave the same product.\n'); return 0 }
        io.err(`Two derivations of the same product differ in ${changes.length} file(s):\n${changes.map(({ action, file_path: file }) => `  ${action} ${file}`).join('\n')}\n`)
        return 1
      }
      case 'metrics': {
        const [dir] = positionals
        if (dir === undefined) { io.err(USAGE); return 2 }
        const limit = values['max-ccn'] === undefined ? undefined : Number(values['max-ccn'])
        const functions = measure({ dir: path.resolve(cwd, dir) })
        const t = totals(functions)
        io.out(`${t.functions} functions, ${t.nloc} NLOC, total CCN ${t.ccn}, max CCN ${t.maxCcn}\n`)
        const over = limit === undefined ? [] : functions.filter((fn) => fn.ccn > limit)
        for (const fn of over) io.err(`over ${limit}: ${fn.file}:${fn.start} ${fn.name} (CCN ${fn.ccn})\n`)
        return over.length === 0 ? 0 : 1
      }
      case 'mr-metrics': {
        if (missing('line', 'specs', 'selection', 'out')) return 2
        const specsDir = path.resolve(cwd, values.specs)
        const out = path.resolve(cwd, values.out)
        const baseLine = values['base-line'] === undefined ? undefined : path.resolve(cwd, values['base-line'])
        const limit = Number(values['max-ccn'] ?? 15)
        const selection = JSON.parse(fs.readFileSync(path.resolve(cwd, values.selection), 'utf8'))
        const tree = await treeOf({ line, scratch: scratchDir(), server, token })
        const specOf = (name) => path.join(specsDir, `${name}.json`)
        const selectionOf = (name) => readSpec(specOf(name)).spec.features

        const measured = []
        const measureProduct = async ({ name, specFile, features }) => {
          const headDir = path.join(out, 'head', name)
          await deriveInto({ line, specFile, outputDir: headDir, server, token, features, root: tree.root.name })
          const head = measure({ dir: headDir })
          let base
          if (baseLine !== undefined) {
            const baseDir = path.join(out, 'base', name)
            await deriveInto({ line: baseLine, specFile, outputDir: baseDir, server, token, features, root: tree.root.name })
            base = measure({ dir: baseDir })
          }
          const over = head.filter((fn) => fn.ccn > limit)
          measured.push({ name, specFile, features: features ?? selectionOf(name), head, comparison: { ...compare({ base, head }), over }, over })
        }
        for (const name of selection.selected) await measureProduct({ name, specFile: specOf(name) })

        // a feature the change touches that no selected product has is still measured: on the smallest product with what it needs added
        const touched = selection.touchedFeatures ?? []
        const uncovered = touched.filter((feature) => !measured.some(({ features }) => completeSelection({ tree, features }).has(feature)))
        const impossible = []
        if (uncovered.length > 0) {
          const sizeOf = (name) => completeSelection({ tree, features: selectionOf(name) }).size
          const smallest = (measured.length > 0 ? measured.map(({ name }) => name) : fs.readdirSync(specsDir).filter((file) => file.endsWith('.json')).map((file) => file.replace(/\.json$/, '')))
            .sort((a, b) => sizeOf(a) - sizeOf(b))[0]
          if (smallest !== undefined) {
            let features = selectionOf(smallest)
            for (const feature of uncovered) {
              const next = activateFeature({ tree, features, feature })
              if (next === undefined) impossible.push(feature)
              else features = next
            }
            if (features !== selectionOf(smallest)) await measureProduct({ name: `synthetic (${smallest} + ${uncovered.filter((f) => !impossible.includes(f)).join(', ')})`, specFile: specOf(smallest), features })
          }
        }

        const attributions = []
        for (const feature of touched) {
          const host = measured.find(({ features }) => completeSelection({ tree, features }).has(feature))
          const without = host === undefined ? undefined : ablateFeature({ tree, features: host.features, feature })
          if (host === undefined || without === undefined) { attributions.push({ feature, product: host?.name, result: undefined }); continue }
          const dir = path.join(out, 'ablate', `${host.name.replace(/[^A-Za-z0-9_.-]/g, '_')}-without-${feature}`)
          await deriveInto({ line, specFile: host.specFile, outputDir: dir, server, token, features: without, root: tree.root.name })
          attributions.push({ feature, product: host.name, result: attribution({ full: host.head, without: measure({ dir }) }) })
        }

        fs.mkdirSync(out, { recursive: true })
        const report = measured.map(({ name, comparison, over }) => ({ name, comparison, over }))
        fs.writeFileSync(path.join(out, 'metrics.md'), renderMarkdown({ products: report, attributions, threshold: limit }))
        fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify({ threshold: limit, products: report.map(({ name, comparison }) => ({ name, base: comparison.base, head: comparison.head })), attributions }, null, 2))
        fs.writeFileSync(path.join(out, 'gl-code-quality-report.json'), JSON.stringify(codeQualityReport({ products: report, threshold: limit }), null, 2))
        const over = report.reduce((sum, { over: list }) => sum + list.length, 0)
        io.out(`${report.length} product(s) measured, ${over} function(s) over CCN ${limit}; report in ${out}\n`)
        return 0
      }
      case 'mr-note': {
        const [file] = positionals
        if (file === undefined) { io.err(USAGE); return 2 }
        const body = fs.readFileSync(path.resolve(cwd, file), 'utf8')
        const marker = values.marker ?? body.split('\n')[0]
        io.out(`Note ${await postNote({ body, marker })}\n`)
        return 0
      }
      case 'fetch-specs': {
        if (missing('line', 'out')) return 2
        const out = path.resolve(cwd, values.out)
        fs.mkdirSync(out, { recursive: true })
        let failed = 0
        for (const { name, repositorio } of readProductsIndex({ lineDir: line }).productos) {
          try {
            const where = locate(repositorio, server)
            const { spec, models } = where.api !== undefined ? await specFromApi(where.api, token) : specFromClone(where.clone, cwd)
            fs.writeFileSync(path.join(out, `${name}.json`), spec)
            for (const [file, text] of Object.entries(models)) {
              fs.mkdirSync(path.join(out, `${name}.models`), { recursive: true })
              fs.writeFileSync(path.join(out, `${name}.models`, file), text)
            }
            io.out(`fetched ${name}\n`)
          } catch (error) {
            failed++
            io.err(`could not fetch ${name} from ${repositorio}: ${error.message.split('\n')[0]}\n`)
          }
        }
        return failed === 0 ? 0 : 1
      }
      case 'commit-lint': {
        const problems = []
        const title = values.title ?? process.env.CI_MERGE_REQUEST_TITLE
        if (title !== undefined && !lintTitle(title)) problems.push(`merge request title: "${printable(title)}"`)
        const [base, head] = [values.base ?? process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA, values.head ?? process.env.CI_COMMIT_SHA]
        if (base !== undefined && head !== undefined) {
          if (!SAFE_REF.test(base) || !SAFE_REF.test(head)) throw new Error('--base and --head must be commit SHAs.')
          let log
          try {
            log = git(['log', '--no-merges', '--format=%h%x09%s', '--end-of-options', `${base}..${head}`], cwd)
          } catch {
            // a shallow clone (GitLab's default GIT_DEPTH) may not have the base
            io.err(`WARNING: cannot read ${base}..${head} (shallow clone? set GIT_DEPTH: 0 or fetch the base): only the title was checked.\n`)
            if (values.strict) return 1
            log = ''
          }
          for (const row of log.split('\n').filter(Boolean)) {
            const [sha, ...rest] = row.split('\t')
            if (!lintTitle(rest.join('\t'))) problems.push(`commit ${sha}: "${printable(rest.join('\t'))}"`)
          }
        } else if (title === undefined) { io.err(`Nothing to check: give --title or --base and --head\n${USAGE}`); return 2 }
        if (problems.length === 0) { io.out('Commits and title follow Conventional Commits.\n'); return 0 }
        io.err(`${values.strict ? 'ERROR' : 'WARNING'}: ${problems.length} message(s) do not follow Conventional Commits (type(scope): description; types: ${COMMIT_TYPES.join(', ')}):\n${problems.map((entry) => `  ${entry}`).join('\n')}\n`)
        return values.strict ? 1 : 0
      }
      case 'release-tag': {
        if (missing('line')) return 2
        const manifestFile = path.join(line, 'spl.json')
        if (!fs.existsSync(manifestFile)) { io.err(`${manifestFile} not found: there is no version to release (check --line).\n`); return 1 }
        const { version } = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
        if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`spl.json has no valid version (${version}).`)
        const prefix = values.prefix ?? 'v'
        if (!/^[0-9A-Za-z._-]*$/.test(prefix)) throw new Error('--prefix may only have letters, digits, . _ -')
        const tag = `${prefix}${version}`
        const project = values.project ?? process.env.CI_PROJECT_ID
        const ref = values.ref ?? process.env.CI_COMMIT_SHA
        if (ref !== undefined && !/^[0-9a-fA-F]{7,64}$/.test(ref)) throw new Error('--ref must be a commit SHA.')
        if (project === undefined || ref === undefined) throw new Error('release-tag needs --project and --ref (or CI_PROJECT_ID and CI_COMMIT_SHA).')
        if (token === undefined) throw new Error('release-tag needs LINEA_CI_TOKEN (a token that can create tags and releases).')
        const provider = deps.providerFor !== undefined ? await deps.providerFor({ server }) : await (async () => {
          if (server === undefined) throw new Error('release-tag needs --server or CI_SERVER_URL.')
          const { createGitProvider } = await import('@lbdudc/linea-git')
          return createGitProvider({ provider: 'gitlab', gitlab: { url: server } })
        })()
        const id = /^\d+$/.test(String(project)) ? Number(project) : project
        // LINEA names its tags the same way, but the bare version is accepted as the same release
        const names = [...new Set([tag, `v${version}`, version])]
        for (const name of names) {
          if (await provider.getRelease({ token, id, tag: name }) !== null) {
            io.out(`${name} already has a release: nothing to do.\n`)
            return 0
          }
        }
        // a tag with no release (a previous run failed half way) only needs the release
        let existingTag
        for (const name of names) if (existingTag === undefined && await provider.getTag({ token, id, tag: name }) !== null) existingTag = name
        const { generateChangelog } = await import('@lbdudc/linea-git')
        const releaseTag = existingTag ?? tag
        const changelog = await generateChangelog({ provider, token, id, to: existingTag ?? ref, title: releaseTag })
        if (values['dry-run']) { io.out(`Would ${existingTag === undefined ? 'create tag and' : 'create only the'} release ${releaseTag} at ${ref} with:\n${changelog.markdown}`); return 0 }
        if (existingTag === undefined) await provider.createTag({ token, id, tag, ref, message: `Release ${tag}` })
        await provider.createRelease({ token, id, tag: releaseTag, name: releaseTag, description: changelog.markdown })
        io.out(`Created ${existingTag === undefined ? 'tag and ' : ''}release ${releaseTag}.\n`)
        return 0
      }
      case 'select-products': {
        if (missing('line', 'specs')) return 2
        const specsDir = path.resolve(cwd, values.specs)
        const products = fs.readdirSync(specsDir).filter((file) => file.endsWith('.json')).sort()
          .map((file) => selectionOf(path.join(specsDir, file)))
        let changed
        if (values.changed !== undefined) changed = csv(values.changed)
        else if (values.base !== undefined && values.head !== undefined) {
          changed = git(['diff', '--name-only', '--no-renames', `${values.base}...${values.head}`], line).split('\n').filter((file) => file !== '')
        } else { io.err(`Give --changed, or --base and --head\n${USAGE}`); return 2 }
        const result = selectProducts({
          changedFiles: changed,
          featuresByFile: await analyzeAnnotations({ lineDir: await platformOf({ lineDir: line, scratch: scratchDir(), server, token }) }),
          products,
          ...(values.max !== undefined ? { max: Number(values.max) } : {}),
          ...(values.baseline !== undefined ? { baseline: Number(values.baseline) } : {})
        })
        if (values['pipeline-out'] !== undefined) {
          writeTextFile({
            filePath: path.resolve(cwd, values['pipeline-out']),
            content: renderChildPipeline({
              products: result.selected,
              specsDir: path.relative(line, specsDir) || '.',
              ...tagsOf(values),
              ...(values['with-drift'] ? { repositories: Object.fromEntries(readProductsIndex({ lineDir: line }).productos.map(({ name, repositorio }) => [name, repositorio])) } : {})
            })
          })
        }
        io.out(`${JSON.stringify(result, null, 2)}\n`)
        return 0
      }
      default:
        io.err(USAGE)
        return command === undefined || command === 'help' || command === '--help' ? 0 : 2
    }
  } catch (error) {
    io.err(`${error.message}\n`)
    return 1
  } finally {
    if (scratch !== undefined) fs.rmSync(scratch, { recursive: true, force: true })
  }
}
