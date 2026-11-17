import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bumpPackageVersion,
  changeProductFeatures,
  configureWorkspace,
  createLocalLine,
  createLocalModularLine,
  createLocalPackage,
  createLocalProduct,
  excludeFromGit,
  findContext,
  initWorkspace,
  listLocalProducts,
  nextVersion,
  readLocalProductSpec,
  readOrigin,
  setLocalLineModules,
  splsUsing,
  writeOrigin
} from '../../src/workspace/index.js'
import { createEngine, MODULAR } from '../modules/helpers.js'

const created: string[] = []
const tmp = (): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linea-workspace-')))
  created.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('versions', () => {
  it('raises patch, minor and major, and refuses anything else', () => {
    expect(nextVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(nextVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(nextVersion('1.2.3', 'major')).toBe('2.0.0')
    expect(() => nextVersion('1.2', 'patch')).toThrow(/x\.y\.z/)
    expect(() => nextVersion('1.2.3', 'huge')).toThrow(/patch/)
  })

  it('bumps the version in the manifest of a package', () => {
    const workdir = initWorkspace(tmp())
    configureWorkspace({ createEngine })
    const pkg = createLocalPackage({ workdir, kind: 'module', name: 'auth' })
    expect(bumpPackageVersion({ dir: pkg.dir, kind: 'module', part: 'minor' })).toEqual({ from: '0.1.0', to: '0.2.0' })
    expect((JSON.parse(fs.readFileSync(path.join(pkg.dir, '.linea', 'module.json'), 'utf8')) as { version: string }).version).toBe('0.2.0')
  })
})

describe('products of a plain SPL', () => {
  const line = (): { workdir: string, lineDir: string } => {
    const workdir = initWorkspace(tmp())
    const made = createLocalLine({ workdir, name: 'shop' })
    return { workdir, lineDir: made.dir }
  }

  it('changing the features only saves (and so raises the version) when the selection changes', () => {
    const { lineDir } = line()
    const product = createLocalProduct({ lineDir, spec: { basicData: { name: 'p1', version: '0.0.0', languages: ['en'] }, features: [] } })
    expect(changeProductFeatures({ lineDir, name: product.name }).changed).toBe(false)
    expect(readLocalProductSpec(product.dir).basicData?.version).toBe('0.0.0')
    expect(() => changeProductFeatures({ lineDir, name: product.name, remove: ['Ghost'] })).toThrow(/does not select Ghost/)
  })

  it('lists a product that is only a folder that came from the host (it has no spec yet)', () => {
    const { lineDir } = line()
    const dir = path.join(lineDir, 'draft')
    fs.mkdirSync(dir)
    expect(listLocalProducts(lineDir).map((p) => p.name)).not.toContain('draft')
    writeOrigin(dir, { kind: 'product', name: 'draft', provider: 'gitlab', projectId: 1, webUrl: 'https://host/shop/draft', defaultBranch: 'main' })
    expect(listLocalProducts(lineDir).map((p) => p.name)).toContain('draft')
    expect(readOrigin(dir)?.kind).toBe('product')
  })
})

describe('what a workspace knows about itself', () => {
  it('finds where a folder stands: workspace, SPL, product', () => {
    const workdir = initWorkspace(tmp())
    const made = createLocalLine({ workdir, name: 'shop' })
    const product = createLocalProduct({ lineDir: made.dir, spec: { basicData: { name: 'p1', version: '0.0.0', languages: ['en'] }, features: [] } })
    const here = findContext(product.dir)
    expect(here.workspace).toBe(workdir)
    expect(here.line?.name).toBe('shop')
    expect(here.product?.name).toBe('p1')
  })

  it('says which SPLs use a module of the workspace', async () => {
    const workdir = initWorkspace(tmp())
    // every SPL has the feature metamodel: the workspace has it as a package, with the grammar it imports
    for (const name of ['featuremodel', 'common']) fs.cpSync(path.join(MODULAR, 'metamodels', name), path.join(workdir, 'metamodels', name), { recursive: true })
    configureWorkspace({ createEngine })
    const draw = createLocalPackage({ workdir, kind: 'module', name: 'draw' })
    const used = createLocalModularLine({ workdir, name: 'gis' })
    createLocalModularLine({ workdir, name: 'other' })
    await setLocalLineModules(workdir, used.dir, { 'file:modules/draw': '^0.1.0' })
    expect(splsUsing({ workdir, pkg: draw })).toEqual(['gis'])
  })

  it('keeps a generated file out of git status without touching the tracked .gitignore, once', () => {
    const repo = tmp()
    fs.mkdirSync(path.join(repo, '.git', 'info'), { recursive: true })
    excludeFromGit(repo, '.linea/x')
    excludeFromGit(repo, '.linea/x')
    expect(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8').match(/\.linea\/x/g)).toHaveLength(1)
  })
})
