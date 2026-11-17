import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runCi } from '../src/cli.mjs'
import { parseLizardCsv } from '../src/metrics.mjs'

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=ci@test', '-c', 'user.name=ci', ...args], { cwd, encoding: 'utf8' })
const run = async (cwd, ...argv) => {
  let out = ''
  let err = ''
  const code = await runCi({ argv, cwd, io: { out: (t) => { out += t }, err: (t) => { err += t } } })
  return { code, out, err }
}
const hasLizard = (() => {
  try { execFileSync((process.env.LINEA_CI_LIZARD ?? 'lizard').split(' ')[0], ['--version'], { stdio: 'ignore' }); return true } catch { return false }
})()

const MODEL = 'features\n\tShop\n\t\tmandatory\n\t\t\tCore\n\t\toptional\n\t\t\tBanner\n'
const BANNER_BASE = '/*% if (feature.Banner) { %*/\nfunction banner(x) {\n  if (x) { return 1 }\n  return 0\n}\n/*% } %*/\n'
const BANNER_HEAD = '/*% if (feature.Banner) { %*/\nfunction banner(x) {\n  if (x) { return 1 } else if (x > 2) { return 2 } else if (x > 3) { return 3 }\n  for (const a of [1]) { if (a && x) { return a } }\n  return 0\n}\n/*% } %*/\n'
const spec = (name, features) => JSON.stringify({ spec: { basicData: { name, version: '0.0.1' }, features } })

describe('parseLizardCsv', () => {
  it('reads functions, with quoted fields', () => {
    const [fn] = parseLizardCsv({ csv: '5,3,40,2,7,"f@1-7@./a.js","./a.js","f","f ( a , b )",1,7\n', root: '.' })
    assert.deepEqual(fn, { file: 'a.js', name: 'f', longName: 'f ( a , b )', ccn: 3, nloc: 5, params: 2, length: 7, start: 1, end: 7 })
  })
})

describe('mr-metrics', { skip: hasLizard ? false : 'lizard is not installed' }, () => {
  let root
  let spl
  let baseSpl
  let specs

  before(() => {
    delete process.env.CI_SERVER_URL
    delete process.env.LINEA_CI_TOKEN
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-ci-metrics-'))
    spl = path.join(root, 'spl')
    const platform = path.join(spl, 'src/platform')
    fs.mkdirSync(path.join(platform, 'code'), { recursive: true })
    fs.writeFileSync(path.join(platform, 'model.uvl'), MODEL)
    fs.writeFileSync(path.join(platform, 'config.json'), JSON.stringify({ ignore: [], delimiters: [{ extension: ['js'], start: '/*%', end: '%*/' }] }))
    fs.writeFileSync(path.join(platform, 'extra.js'), '')
    fs.copyFileSync(path.join(fileURLToPath(import.meta.url), '../../../core/src/line/templates/core/transformation.js'), path.join(platform, 'transformation.js'))
    fs.writeFileSync(path.join(platform, 'code/core.js'), 'function core(x) {\n  return x\n}\n')
    fs.writeFileSync(path.join(platform, 'code/banner.js'), BANNER_BASE)
    git(spl, 'init', '-q', '-b', 'main')
    git(spl, 'add', '.')
    git(spl, 'commit', '-qm', 'base')
    baseSpl = path.join(root, 'base')
    git(root, 'clone', '-q', spl, baseSpl)
    fs.writeFileSync(path.join(platform, 'code/banner.js'), BANNER_HEAD)
    git(spl, 'commit', '-qam', 'head')
    specs = path.join(root, 'specs')
    fs.mkdirSync(specs)
    fs.writeFileSync(path.join(specs, 'prod-small.json'), spec('prod-small', ['Shop', 'Core']))
    fs.writeFileSync(path.join(specs, 'prod-banner.json'), spec('prod-banner', ['Shop', 'Core', 'Banner']))
  })

  after(() => fs.rmSync(root, { recursive: true, force: true }))

  it('measures the selected products against the base, attributes the touched feature, and reports what is over the limit', async () => {
    const selected = await run(spl, 'select-products', '--line', '.', '--specs', specs, '--changed', 'src/platform/code/banner.js', '--baseline', '0')
    const selection = path.join(root, 'selection.json')
    fs.writeFileSync(selection, selected.out)
    assert.deepEqual(JSON.parse(selected.out).selected, ['prod-banner'])

    const out = path.join(root, 'metrics')
    const result = await run(spl, 'mr-metrics', '--line', '.', '--specs', specs, '--selection', selection, '--out', out, '--base-line', baseSpl, '--max-ccn', '4')
    assert.equal(result.code, 0, result.err)

    const metrics = JSON.parse(fs.readFileSync(path.join(out, 'metrics.json'), 'utf8'))
    const [banner] = metrics.products
    assert.ok(banner.head.ccn > banner.base.ccn, `head ${banner.head.ccn} should be more complex than base ${banner.base.ccn}`)
    const [attributed] = metrics.attributions
    assert.equal(attributed.feature, 'Banner')
    assert.equal(attributed.product, 'prod-banner')
    assert.equal(attributed.result.functions, 1)
    assert.ok(attributed.result.ccn >= 5)

    const markdown = fs.readFileSync(path.join(out, 'metrics.md'), 'utf8')
    assert.match(markdown, /linea-ci:metrics/)
    assert.match(markdown, /\| prod-banner \|/)
    assert.match(markdown, /\| Banner \| prod-banner \| 1 \|/)

    const quality = JSON.parse(fs.readFileSync(path.join(out, 'gl-code-quality-report.json'), 'utf8'))
    assert.equal(quality.length, 1)
    assert.equal(quality[0].location.path, 'banner.js')
    assert.match(quality[0].description, /banner has a cyclomatic complexity of \d+ \(limit 4\)/)
  })

  it('measures a touched feature that no selected product has on a synthetic configuration', async () => {
    const selection = path.join(root, 'selection-small.json')
    fs.writeFileSync(selection, JSON.stringify({ selected: ['prod-small'], touchedFeatures: ['Banner'], all: false }))
    const out = path.join(root, 'metrics-synthetic')
    const result = await run(spl, 'mr-metrics', '--line', '.', '--specs', specs, '--selection', selection, '--out', out, '--base-line', baseSpl)
    assert.equal(result.code, 0, result.err)
    const metrics = JSON.parse(fs.readFileSync(path.join(out, 'metrics.json'), 'utf8'))
    assert.deepEqual(metrics.products.map(({ name }) => name), ['prod-small', 'synthetic (prod-small + Banner)'])
    assert.equal(metrics.products[0].head.functions, 1)
    assert.ok(metrics.products[1].head.ccn > metrics.products[1].base.ccn)
    assert.equal(metrics.attributions[0].product, 'synthetic (prod-small + Banner)')
    assert.equal(metrics.attributions[0].result.functions, 1)
  })

  it('metrics fails a derived product over the limit', async () => {
    const dir = path.join(root, 'metrics/head/prod-banner')
    assert.equal((await run(root, 'metrics', dir, '--max-ccn', '100')).code, 0)
    assert.equal((await run(root, 'metrics', dir, '--max-ccn', '2')).code, 1)
  })
})

describe('mr-note', () => {
  it('creates the note, and updates it the next time', async () => {
    const notes = []
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        assert.equal(req.headers['private-token'], 'tok')
        if (req.method === 'GET') return res.end(JSON.stringify(notes))
        if (req.method === 'POST') { notes.push({ id: 7, body: JSON.parse(body).body }); res.statusCode = 201; return res.end('{}') }
        if (req.method === 'PUT') { notes[0].body = JSON.parse(body).body; return res.end('{}') }
      })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-ci-note-'))
    const file = path.join(dir, 'note.md')
    const env = { CI_API_V4_URL: `http://127.0.0.1:${server.address().port}/api/v4`, CI_PROJECT_ID: '12', CI_MERGE_REQUEST_IID: '3', LINEA_CI_TOKEN: 'tok' }
    Object.assign(process.env, env)
    try {
      fs.writeFileSync(file, '<!-- linea-ci:metrics -->\nfirst\n')
      assert.match((await run(dir, 'mr-note', file)).out, /created/)
      fs.writeFileSync(file, '<!-- linea-ci:metrics -->\nsecond\n')
      assert.match((await run(dir, 'mr-note', file)).out, /updated/)
      assert.equal(notes.length, 1)
      assert.match(notes[0].body, /second/)
    } finally {
      for (const key of Object.keys(env)) delete process.env[key]
      server.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('says what is missing outside a merge request pipeline', async () => {
    const file = path.join(os.tmpdir(), 'linea-ci-note-missing.md')
    fs.writeFileSync(file, 'x')
    const { code, err } = await run(os.tmpdir(), 'mr-note', file)
    assert.equal(code, 1)
    assert.match(err, /CI_API_V4_URL/)
    fs.rmSync(file)
  })
})
