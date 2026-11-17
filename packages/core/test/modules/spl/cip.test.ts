import { describe, expect, it } from 'vitest'
import { planPlatform } from '../../../src/index.js'
import { cipFragmentPath, cipKind, cipTarget } from '../../../src/modules/spl/cip.js'
import { filesOf, loadFixture, resolveFixtureData } from '../helpers.js'

const CORE = 'file:modules/core'
const UM = 'file:modules/user-management'

const marker = (name: string): string => `/*→ ${name} ←*/`

describe('code insertion point paths', () => {
  it('tells main files from fragments, and gives the file they make', () => {
    expect(cipKind({ file: 'a/b/_x.cipmain.vue' })).toBe('main')
    expect(cipKind({ file: 'a/b/_x.cip.vue' })).toBe('fragment')
    expect(cipKind({ file: 'a/b/x.vue' })).toBeUndefined()
    expect(cipKind({ file: 'a.cip/b/x.vue' })).toBeUndefined()
    expect(cipTarget({ file: 'a/b/_x.cipmain.vue' })).toBe('a/b/_x.vue')
    expect(cipTarget({ file: 'a/b/_x.cip.vue' })).toBe('a/b/_x.vue')
    expect(cipFragmentPath({ main: 'a/b/_x.cipmain.vue' })).toBe('a/b/_x.cip.vue')
  })
})

describe('planPlatform with code insertion points', () => {
  const plan = async (change: (core: Record<string, string | Uint8Array>, um: Record<string, string | Uint8Array>) => void) => {
    const fixture = loadFixture()
    change(filesOf(fixture, CORE), filesOf(fixture, UM))
    const { resolved, spl } = await resolveFixtureData(fixture)
    return planPlatform({ resolved, spl })
  }
  const text = (content: Uint8Array | undefined): string => new TextDecoder().decode(content)

  it('splices the fragments of other modules into the main file, and neither is code of the product', async () => {
    const result = await plan((core, um) => {
      core['code/client/menu.cipmain.vue'] = `<ul>\n${marker('menu')}\n</ul>\n`
      um['code/client/menu.cip.vue'] = `${marker('menu')}\n<li>users</li>\n${marker('menu')}\n`
    })
    const base = 'src/platform/code/client/menu'
    expect(result.diagnostics).toEqual([])
    expect(text(result.files.get(`${base}.vue`)?.content)).toContain('<li>users</li>')
    expect(text(result.files.get(`${base}.vue`)?.content)).not.toContain('→')
    expect(result.files.has(`${base}.cipmain.vue`)).toBe(false)
    expect(result.files.has(`${base}.cip.vue`)).toBe(false)
  })

  it('leaves a main file without fragments as the file it is, and a fragment without a main file out', async () => {
    const result = await plan((core, um) => {
      core['code/client/menu.cipmain.vue'] = `<ul>${marker('menu')}</ul>\n`
      um['code/client/orphan.cip.vue'] = `${marker('x')}\nY\n${marker('x')}\n`
    })
    expect(result.diagnostics).toEqual([])
    expect(text(result.files.get('src/platform/code/client/menu.vue')?.content)).toBe('<ul>\n</ul>\n')
    expect(result.files.has('src/platform/code/client/orphan.vue')).toBe(false)
    expect(result.files.has('src/platform/code/client/orphan.cip.vue')).toBe(false)
  })

  it('reports a main file two modules both provide with other content, as for any file', async () => {
    const result = await plan((core, um) => {
      core['code/client/menu.cipmain.vue'] = `${marker('a')}\n`
      um['code/client/menu.cipmain.vue'] = `${marker('b')}\n`
    })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringMatching(/also provided by/) as string }))
  })

  it('chains an extra.cipmain.js and a transformation.cipmain.js, filled by the cip.js of other modules', async () => {
    const result = await plan((core, um) => {
      delete core['.linea/config/extra.js']
      delete core['.linea/config/transformation.js']
      core['.linea/config/extra.cipmain.js'] = `function fromCore() {}\n${marker('extra')}\n`
      core['.linea/config/transformation.cipmain.js'] = `function transform(input) {\n${marker('steps')}\n  return input\n}\n`
      um['.linea/config/transformation.cip.js'] = `${marker('steps')}\n  input.um = true\n${marker('steps')}\n`
    })
    expect(result.extraJs).toContain('function fromCore() {}')
    expect(result.transformation).toContain('input.um = true')
    expect(result.transformation).not.toContain('→')
  })
})
