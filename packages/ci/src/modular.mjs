import fs from 'node:fs'
import path from 'node:path'
import {
  configure,
  createFsFiles,
  deriveModularProduct,
  parseLock,
  parseSplManifest,
  prepareEngine,
  resolveSpl,
  writePlatform
} from '@lbdudc/linea-core'

/**
 * A line made of modules keeps no platform in its repository: the feature model, the code and the helpers are composed from the modules
 * it asks for, which live in the registry of the git host. These are the steps that compose it, so the rest of linea-ci can work on it as
 * on any other line.
 */

export const isModularLine = (lineDir) =>
  fs.existsSync(path.join(lineDir, 'spl.json')) && !fs.existsSync(path.join(lineDir, 'src/platform/model.uvl'))

const open = async ({ lineDir, server, token }) => {
  if (server === undefined) throw new Error('The line is made of modules: give --server (or set CI_SERVER_URL) to read them from the git host.')
  const [{ Bango }, { createPackageSource }] = await Promise.all([import('@lbdudc/bango'), import('@lbdudc/linea-git')])
  const spl = parseSplManifest({ content: fs.readFileSync(path.join(lineDir, 'spl.json'), 'utf8') })
  const lockFile = path.join(lineDir, 'linea.lock.json')
  const lock = fs.existsSync(lockFile) ? parseLock({ content: fs.readFileSync(lockFile, 'utf8') }) : undefined
  // CI_JOB_TOKEN is not accepted by the packages API as a PRIVATE-TOKEN: a token that can read the registry is needed
  const source = createPackageSource({ provider: 'gitlab', gitlab: { url: server.replace(/\/$/, '') } }, { token: token ?? '', userId: 'linea-ci' })
  const resolved = await resolveSpl({ spl, source, lock })
  return { resolved, files: createFsFiles({ dir: lineDir }), createEngine: () => new Bango() }
}

const problemsOf = (diagnostics) =>
  diagnostics.filter(({ severity }) => severity === 'error').map(({ file, message }) => `${file === undefined ? '' : `${file}: `}${message}`)

/** Writes the platform of the line, composed from its modules, under `out` as an ordinary line (`src/platform/...`). */
export const composeLine = async ({ lineDir, out, server, token }) => {
  const { resolved, files, createEngine } = await open({ lineDir, server, token })
  const { engine, metamodels, diagnostics, contributed } = await prepareEngine({ resolved, createEngine })
  const configuration = await configure({ engine, resolved, spl: files, metamodels, offered: contributed, diagnostics, loadCode: true })
  const problems = problemsOf(diagnostics)
  if (problems.length > 0) throw new Error(`The line does not compose:\n  ${problems.join('\n  ')}`)
  writePlatform({ plan: configuration.plan, lineDir: out })
  return out
}

/** The directory to read the platform of a line from: the line itself, or its composition when it is made of modules. */
export const platformOf = async ({ lineDir, scratch, server, token }) =>
  isModularLine(lineDir) ? composeLine({ lineDir, out: path.join(scratch, 'composed'), server, token }) : lineDir

/** `.linea/models/<metamodel>.<ext>` of a product as `{ metamodel: text }`. */
export const readModels = (dir) =>
  Object.fromEntries(fs.readdirSync(dir).map((file) => [file.replace(/\.[^.]+$/, ''), fs.readFileSync(path.join(dir, file), 'utf8')]))

export const deriveModular = async ({ lineDir, spec, models, outputDir, server, token }) => {
  const { resolved, files, createEngine } = await open({ lineDir, server, token })
  const result = await deriveModularProduct({ resolved, spl: files, spec, models, createEngine, outputDir })
  const problems = problemsOf(result.diagnostics)
  if (problems.length > 0) throw new Error(`The product does not fit the line:\n  ${problems.join('\n  ')}`)
  return result
}
