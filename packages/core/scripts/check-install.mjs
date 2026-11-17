/**
 * Installs the packed tarball into a throwaway project and drives a real flow.
 *
 * The test suite imports from `src/`; this is the only check that exercises what
 * a CONSUMER actually gets — `files`, `exports`, the `prepare` build, and the
 * copied assets (templates and wheels). A change to any of those passes every
 * other check and breaks installation, which is the kind of defect you find out
 * about from someone else.
 *
 * Deliberately does NOT touch the analysis runtime: booting Pyodide costs ~2.3 s
 * and ~180 MB, and it is already covered by test/analysis/offline.test.ts. What
 * matters here is that the package resolves and its assets shipped.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Kept inline so the check is one file: a separate fixture under test/ would be
// packed or ignored depending on `files`, which is part of what is being tested.
const CONSUMER_SCRIPT = `
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  writeLineScaffold, FEATURE_MODEL_PATH, parseSplManifest,
  validateProductSpec, normalizeProductSpec, incrementVersion,
  emptyProductsIndex, addProductToIndex, serializeProductsIndex, parseProductsIndex,
  diffDirectories, deriveProduct
} from '@lbdudc/linea-core'

const BACKSLASH = String.fromCharCode(92)
let failures = 0
const ok = (label, cond) => {
  if (!cond) failures += 1
  console.log((cond ? 'OK   ' : 'FALLO') + '  ' + label)
}

const line = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-line-'))
const { files } = writeLineScaffold({ dir: line, name: 'MiLinea' })
ok('scaffold escribe el manifiesto y el modelo de features', files.some((f) => f.path === 'spl.json') && files.some((f) => f.path === FEATURE_MODEL_PATH))
ok('rutas POSIX', files.every((f) => !f.path.includes(BACKSLASH)))
ok('templates empaquetados (extra.js no vacio)', files.some((f) => f.path.endsWith('extra.js') && f.content.length > 0))

const model = fs.readFileSync(path.join(line, FEATURE_MODEL_PATH), 'utf8')
ok('semilla con el nombre', model.includes('MiLinea'))
ok('manifiesto legible', parseSplManifest({ content: fs.readFileSync(path.join(line, 'spl.json'), 'utf8') }).name === 'MiLinea')

const spec = { basicData: { name: 'p1', version: '1.0.0' }, features: ['MiLinea'] }
ok('spec valido', validateProductSpec({ spec }).valid)
ok('spec invalido rechazado', !validateProductSpec({ spec: { basicData: { name: 'a b', version: 'x' } } }).valid)
const norm = normalizeProductSpec({ spec })
ok('defaults aplicados', norm.basicData.SRID === '4326' && norm.basicData.languages.length === 3)
ok('languages [] se conserva', normalizeProductSpec({ spec: { basicData: { name: 'p', version: '1.0.0', languages: [] }, features: [] } }).basicData.languages.length === 0)
ok('incrementVersion', incrementVersion({ version: '1.2.3', index: 1 }) === '1.3.0')

const idx = addProductToIndex({ index: emptyProductsIndex(), product: { name: 'p1', repositorio: 'g/p1' } })
ok('indice determinista', serializeProductsIndex({ index: idx }) === serializeProductsIndex({ index: idx }))

// La version es OPCIONAL: la entrada que la lleva la emite, la que no, no emite
// la clave. Si eso cambiase, todos los products.json anteriores cambiarian de
// bytes al releerlos y reescribirlos.
const idxConVersion = addProductToIndex({ index: idx, product: { name: 'p2', repositorio: 'g/p2', version: '1.0.0' } })
const textoIndice = serializeProductsIndex({ index: idxConVersion })
ok('version opcional emitida solo cuando existe', textoIndice.includes('"version": "1.0.0"') && (textoIndice.match(/"version"/g) || []).length === 1)
ok('version opcional sobrevive al round trip', serializeProductsIndex({ index: parseProductsIndex({ content: textoIndice }) }) === textoIndice)

const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-old-'))
const changes = diffDirectories({ oldDir: empty, newDir: line })
ok('diff produce cambios', changes.length > 0)
ok('file_path POSIX y relativo', changes.every((c) => !c.file_path.includes(BACKSLASH) && !path.isAbsolute(c.file_path)))

// Punta a punta de verdad: una linea recien sembrada es derivable, porque el
// scaffold incluye los ficheros de pipeline bajo src/platform/code/. Esto
// ejercita spl-js-engine desde el paquete instalado, que es la dependencia mas
// fragil (va fijada a un commit de git).
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-out-'))
// el scaffold ya no escribe el UVL de la plataforma (se compone del modelo de features al derivar): deriveProduct lo lee de disco
fs.writeFileSync(path.join(line, 'src', 'platform', 'model.uvl'), 'features\\n\\tMiLinea\\n\\t\\toptional\\n\\t\\t\\tExtra\\n')
await deriveProduct({ lineDir: line, spec, outputDir: out })
const derived = fs.readdirSync(out, { recursive: true }).length
ok('derivacion produce ficheros', derived > 0)

// Y la taxonomia de errores tambien viaja en el paquete publicado.
let typedError = false
try {
  await deriveProduct({ lineDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ci-nada-')), spec, outputDir: out })
} catch (error) {
  typedError = error?.code === 'LINE_PLATFORM_NOT_FOUND'
}
ok('linea sin plataforma da LINE_PLATFORM_NOT_FOUND', typedError)

fs.rmSync(out, { recursive: true, force: true })

fs.rmSync(line, { recursive: true, force: true })
fs.rmSync(empty, { recursive: true, force: true })

console.log('')
if (failures === 0) console.log('INSTALL CHECK OK')
else { console.log('INSTALL CHECK CON ' + failures + ' FALLOS'); process.exit(1) }
`

const npm = (args, cwd) =>
  execFileSync(process.execPath, [process.env.npm_execpath ?? 'npm', ...args], {
    cwd,
    stdio: 'pipe',
    encoding: 'utf8'
  })

const root = process.cwd()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-core-install-'))
let failed = false

try {
  const packed = npm(['pack', '--silent', '--pack-destination', work], root).trim().split('\n').pop()
  const tarball = path.join(work, packed)
  if (!fs.existsSync(tarball)) throw new Error(`npm pack produced nothing at ${tarball}`)

  const consumer = path.join(work, 'consumer')
  fs.mkdirSync(consumer)
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer', version: '1.0.0', type: 'module', private: true }, null, 2)
  )
  npm(['install', tarball, '--silent', '--no-audit', '--no-fund'], consumer)

  fs.writeFileSync(path.join(consumer, 'run.mjs'), CONSUMER_SCRIPT)
  const output = execFileSync(process.execPath, ['run.mjs'], {
    cwd: consumer,
    stdio: 'pipe',
    encoding: 'utf8'
  })
  process.stdout.write(output)
  if (!output.includes('INSTALL CHECK OK')) throw new Error('the consumer flow did not complete')
} catch (error) {
  failed = true
  console.error('\ncheck:install FAILED\n')
  console.error(error.stdout?.toString() ?? '')
  console.error(error.stderr?.toString() ?? error.message)
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}

process.exit(failed ? 1 : 0)
