import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { formatDirectory } from '@lbdudc/linea-core'
import { runCi } from '../src/cli.mjs'

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=ci@test', '-c', 'user.name=ci', ...args], { cwd, encoding: 'utf8' })

const run = async (cwd, ...argv) => {
  let out = ''
  let err = ''
  const code = await runCi({ argv, cwd, io: { out: (t) => { out += t }, err: (t) => { err += t } } })
  return { code, out, err }
}

const PACKAGE_JSON = '{\n  "name": "###<= normalize(data.basicData.name) >###",\n  "main": "src/index.js"\n}\n'
const CONFIG = {
  ignore: ['build'],
  delimiters: [
    { extension: ['js', 'md'], start: '/*%', end: '%*/' },
    { extension: ['json'], start: '###<', end: '>###' }
  ]
}
const MODEL = 'features\n\tShop\n\t\tmandatory\n\t\t\tCore\n\t\toptional\n\t\t\tBanner\n\t\t\tLogger\n'

const productSpec = (name, features) => JSON.stringify({ spec: { basicData: { name, version: '0.0.1' }, features } })

let root
let splDir
let specs

before(() => {
  delete process.env.CI_SERVER_URL
  delete process.env.LINEA_CI_TOKEN
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-ci-e2e-'))
  splDir = path.join(root, 'spl')
  const platform = path.join(splDir, 'src/platform')
  fs.mkdirSync(path.join(platform, 'code/src'), { recursive: true })
  fs.writeFileSync(path.join(platform, 'model.uvl'), MODEL)
  fs.writeFileSync(path.join(platform, 'config.json'), JSON.stringify(CONFIG))
  fs.writeFileSync(path.join(platform, 'extra.js'), 'function normalize(s) {\n  return s\n}\n')
  fs.copyFileSync(
    path.join(fileURLToPath(import.meta.url), '../../../core/src/line/templates/core/transformation.js'),
    path.join(platform, 'transformation.js')
  )
  fs.writeFileSync(path.join(platform, 'code/package.json'), PACKAGE_JSON)
  fs.writeFileSync(path.join(platform, 'code/src/banner.js'), '/*% if (feature.Banner) { %*/\nconsole.log("banner")\n/*% } %*/\n')
  fs.writeFileSync(path.join(platform, 'code/src/logger.js'), '/*% if (feature.Logger) { %*/\nconsole.log("log")\n/*% } %*/\n')
  fs.writeFileSync(path.join(platform, 'code/src/index.js'), 'console.log("hello")\n')

  // product repositories: bare remotes with a .linea/spec.json
  const products = [['prod-small', ['Shop', 'Core']], ['prod-banner', ['Shop', 'Core', 'Banner']], ['prod-logger', ['Shop', 'Core', 'Logger']]]
  const index = { productos: [] }
  for (const [name, features] of products) {
    const work = path.join(root, `work-${name}`)
    fs.mkdirSync(path.join(work, '.linea'), { recursive: true })
    fs.writeFileSync(path.join(work, '.linea/spec.json'), productSpec(name, features))
    git(work, 'init', '-q', '-b', 'main')
    git(work, 'add', '.')
    git(work, 'commit', '-qm', 'init')
    const bare = path.join(root, `${name}.git`)
    git(root, 'clone', '-q', '--bare', work, bare)
    index.productos.push({ name, repositorio: bare, version: '0.0.1' })
  }
  fs.writeFileSync(path.join(splDir, 'products.json'), JSON.stringify(index))
  git(splDir, 'init', '-q', '-b', 'main')
  git(splDir, 'add', '.')
  git(splDir, 'commit', '-qm', 'base')
  specs = path.join(root, 'specs')
})

after(() => fs.rmSync(root, { recursive: true, force: true }))

describe('linea-ci', () => {
  it('fetch-specs clones the products and collects their specs', async () => {
    const { code, out } = await run(root, 'fetch-specs', '--line', splDir, '--out', specs)
    assert.equal(code, 0)
    assert.match(out, /fetched prod-banner/)
    assert.deepEqual(fs.readdirSync(specs).sort(), ['prod-banner.json', 'prod-logger.json', 'prod-small.json'])
  })

  it('fetch-specs resolves a repository path against the server and fails on an unreachable one', async () => {
    const copy = path.join(root, 'spl-remote')
    fs.cpSync(splDir, copy, { recursive: true })
    fs.writeFileSync(path.join(copy, 'products.json'), JSON.stringify({ productos: [{ name: 'x', repositorio: 'group/x' }] }))
    const { code, err } = await run(root, 'fetch-specs', '--line', copy, '--out', path.join(root, 'nope'))
    assert.equal(code, 1)
    assert.match(err, /give --server or set CI_SERVER_URL/)
  })

  it('fetch-specs reads the spec through the GitLab API for a project path, with the token', async () => {
    const seen = []
    const server = http.createServer((req, res) => {
      seen.push({ url: req.url, token: req.headers['private-token'] })
      if (req.url === '/api/v4/projects/g%2Fp%2Fdemo') return res.end(JSON.stringify({ default_branch: 'trunk' }))
      if (req.url === '/api/v4/projects/g%2Fp%2Fdemo/repository/files/.linea%2Fspec.json/raw?ref=trunk') return res.end(productSpec('demo', ['Shop', 'Core']))
      res.statusCode = 404
      res.end('{}')
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const url = `http://127.0.0.1:${server.address().port}`
      const copy = path.join(root, 'spl-api')
      fs.cpSync(splDir, copy, { recursive: true })
      fs.writeFileSync(path.join(copy, 'products.json'), JSON.stringify({ productos: [{ name: 'demo', repositorio: 'g/p/demo' }, { name: 'gone', repositorio: 'g/p/gone' }] }))
      const out = path.join(root, 'api-specs')
      const { code, err } = await run(root, 'fetch-specs', '--line', copy, '--out', out, '--server', url, '--token', 'secret')
      assert.equal(code, 1)
      assert.match(err, /could not fetch gone .*404/)
      assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'demo.json'), 'utf8')).spec.basicData.name, 'demo')
      assert.ok(seen.length > 0 && seen.every((request) => request.token === 'secret'))
    } finally {
      server.close()
    }
  })

  it('validate-specs accepts the real specs and rejects a broken one', async () => {
    const good = await run(root, 'validate-specs', '--line', splDir, ...fs.readdirSync(specs).map((f) => path.join(specs, f)))
    assert.equal(good.code, 0)
    const broken = path.join(root, 'broken.json')
    fs.writeFileSync(broken, productSpec('broken', ['Shop', 'Ghost']))
    const bad = await run(root, 'validate-specs', '--line', splDir, broken)
    assert.equal(bad.code, 1)
    assert.match(bad.err, /"Ghost" is not a feature of the model/)
    assert.doesNotMatch(bad.err, /mandatory/)
  })

  it('derive builds the product and check-leftovers passes on it', async () => {
    const out = path.join(root, 'derived-banner')
    const derived = await run(root, 'derive', '--line', splDir, '--spec', path.join(specs, 'prod-banner.json'), '--out', out)
    assert.equal(derived.code, 0, derived.err)
    assert.match(fs.readFileSync(path.join(out, 'src/banner.js'), 'utf8'), /console\.log\("banner"\)/)
    assert.equal((await run(root, 'check-leftovers', out, '--line', splDir)).code, 0)
  })

  it('check-determinism passes for a stable line and fails for one that is not', async () => {
    const spec = path.join(specs, 'prod-banner.json')
    assert.equal((await run(root, 'check-determinism', '--line', splDir, '--spec', spec)).code, 0)
    const unstable = path.join(root, 'unstable')
    fs.cpSync(splDir, unstable, { recursive: true })
    fs.appendFileSync(path.join(unstable, 'src/platform/code/src/index.js'), '// built /*%= Math.random() %*/\n')
    const { code, err } = await run(root, 'check-determinism', '--line', unstable, '--spec', spec)
    assert.equal(code, 1)
    assert.match(err, /differ in 1 file.*index\.js/s)
  })

  it('check-leftovers falls back to the default delimiters for a line that keeps no config.json', async () => {
    const bare = path.join(root, 'bare-line')
    fs.mkdirSync(bare)
    fs.writeFileSync(path.join(bare, 'spl.json'), '{}')
    const dir = path.join(root, 'dirty-bare')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'a.js'), 'x = /*%= y %*/\n')
    const { code, err } = await run(root, 'check-leftovers', dir, '--line', bare)
    assert.equal(code, 1)
    assert.match(err, /a\.js:1/)
  })

  it('check-leftovers fails on a product that still has annotations', async () => {
    const dir = path.join(root, 'dirty')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name": "/*%= x %*/"}\n')
    const { code, err } = await run(root, 'check-leftovers', dir, '--line', splDir)
    assert.equal(code, 1)
    assert.match(err, /package\.json:1/)
  })

  it('select-products picks only the products a merge request can break, from the git diff', async () => {
    git(splDir, 'checkout', '-q', '-b', 'mr')
    fs.appendFileSync(path.join(splDir, 'src/platform/code/src/banner.js'), '// tweak\n')
    git(splDir, 'commit', '-qam', 'touch banner')
    const pipeline = path.join(root, 'child.yml')
    const { code, out } = await run(splDir, 'select-products', '--line', '.', '--specs', specs, '--base', 'main', '--head', 'mr', '--baseline', '0', '--pipeline-out', pipeline)
    assert.equal(code, 0)
    const result = JSON.parse(out)
    assert.deepEqual(result.selected, ['prod-banner'])
    assert.deepEqual(result.touchedFeatures, ['Banner'])
    const yaml = fs.readFileSync(pipeline, 'utf8')
    assert.match(yaml, /product:prod-banner:/)
    assert.doesNotMatch(yaml, /prod-logger/)
  })

  it('select-products selects everything when the feature model changes', async () => {
    fs.appendFileSync(path.join(splDir, 'src/platform/model.uvl'), '')
    fs.writeFileSync(path.join(splDir, 'src/platform/model.uvl'), `${MODEL}\t\t\tExtra\n`)
    git(splDir, 'commit', '-qam', 'new feature')
    const { code, out } = await run(splDir, 'select-products', '--line', '.', '--specs', specs, '--base', 'main', '--head', 'mr')
    assert.equal(code, 0)
    const result = JSON.parse(out)
    assert.equal(result.all, true)
    assert.equal(result.selected.length, 3)
  })

  it('sample-configs writes valid specs that cover every pair of features', async () => {
    const out = path.join(root, 'samples')
    const { code, out: printed } = await run(root, 'sample-configs', '--line', splDir, '--specs', specs, '--out', out)
    assert.equal(code, 0)
    const { template, samples } = JSON.parse(printed)
    assert.equal(template, 'prod-small')
    assert.ok(samples.length >= 2)
    assert.equal((await run(root, 'validate-specs', '--line', splDir, out)).code, 0)
    const features = samples.map((name) => JSON.parse(fs.readFileSync(path.join(out, `${name}.json`), 'utf8')).spec.features)
    assert.ok(features.some((on) => on.includes('Banner') && on.includes('Logger')), 'Banner and Logger together')
    assert.ok(features.some((on) => on.includes('Banner')) && features.some((on) => on.includes('Logger')))
  })

  it('check-drift passes for what the line generates and fails for a hand-edited product', async () => {
    const spec = path.join(specs, 'prod-banner.json')
    const product = path.join(root, 'drift-product')
    assert.equal((await run(root, 'derive', '--line', splDir, '--spec', spec, '--out', product)).code, 0)
    await formatDirectory({ dir: product })
    fs.writeFileSync(path.join(product, 'NOTES.md'), 'a file of the product that the line does not generate\n')
    assert.equal((await run(root, 'check-drift', '--line', splDir, '--spec', spec, '--product', product)).code, 0)
    fs.appendFileSync(path.join(product, 'src/banner.js'), '// edited by hand\n')
    fs.rmSync(path.join(product, 'src/index.js'))
    const { code, err } = await run(root, 'check-drift', '--line', splDir, '--spec', spec, '--product', product)
    assert.equal(code, 1)
    assert.match(err, /changed src\/banner\.js/)
    assert.match(err, /missing src\/index\.js/)
    assert.doesNotMatch(err, /NOTES/)
  })

  it('check-version asks for a higher version when features are removed', async () => {
    const make = (name, version, model) => {
      const dir = path.join(root, name)
      fs.cpSync(splDir, dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'spl.json'), JSON.stringify({ name: 'x', version }))
      fs.writeFileSync(path.join(dir, 'src/platform/model.uvl'), model)
      return dir
    }
    const base = make('ver-base', '1.0.0', MODEL)
    const smaller = 'features\n\tShop\n\t\tmandatory\n\t\t\tCore\n\t\toptional\n\t\t\tBanner\n'
    const same = make('ver-same', '1.0.0', smaller)
    const bumped = make('ver-bumped', '1.1.0', smaller)
    const grown = make('ver-grown', '1.0.0', `${MODEL}\t\t\tExtra\n`)
    const failing = await run(root, 'check-version', '--line', same, '--base-line', base)
    assert.equal(failing.code, 1)
    assert.match(failing.err, /Logger/)
    assert.equal((await run(root, 'check-version', '--line', bumped, '--base-line', base)).code, 0)
    assert.equal((await run(root, 'check-version', '--line', grown, '--base-line', base)).code, 0)
  })

  it('release-products asks LINEA to generate the products of the line again', async () => {
    const generated = []
    const server = http.createServer((req, res) => {
      assert.equal(req.headers.authorization, 'Bearer session')
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        if (req.url === '/api/products/enrolled') return res.end(JSON.stringify([{ _id: 'p1', name: 'a', line: 'x' }, { _id: 'p2', name: 'b', line: 'other' }, { _id: 'p3', name: 'c', line: 'x' }]))
        generated.push({ url: req.url, body: JSON.parse(body) })
        res.statusCode = req.url.includes('p3') ? 500 : 200
        res.end('{}')
      })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    process.env.LINEA_TOKEN = 'session'
    try {
      const { code, out, err } = await run(root, 'release-products', '--linea-url', `http://127.0.0.1:${server.address().port}`, '--line', 'x', '--bump', 'minor')
      assert.equal(code, 1)
      assert.match(out, /generated a/)
      assert.match(err, /could not generate c: 500/)
      assert.deepEqual(generated, [{ url: '/api/products/p1/generate', body: { bump: 'minor' } }, { url: '/api/products/p3/generate', body: { bump: 'minor' } }])
    } finally {
      delete process.env.LINEA_TOKEN
      server.close()
    }
  })

  it('usage errors exit with 2', async () => {
    assert.equal((await run(root, 'derive')).code, 2)
    assert.equal((await run(root, 'nonsense')).code, 2)
  })
})
