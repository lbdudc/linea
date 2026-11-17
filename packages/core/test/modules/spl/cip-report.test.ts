import { describe, it, expect } from 'vitest'
import { createMemoryPackageSource, describeCips } from '../../../src/index.js'
import type { ResolvedModule } from '../../../src/modules/types.js'

const moduleOf = async (location: string, files: Record<string, string>): Promise<ResolvedModule> => {
  const source = createMemoryPackageSource({ packages: { [location]: { '1.0.0': files } } })
  return { location, version: '1.0.0', files: await source.open({ location, version: '1.0.0' }) } as ResolvedModule
}

const MAIN = 'a\n/*→ head ←*/\nb\n/*→ tail ←*/\nc\n'

describe('describeCips', () => {
  it('says who fills each marker and what comes out', async () => {
    const { compositions } = await describeCips({ modules: [
      await moduleOf('m:main', { 'code/x.cipmain.js': MAIN }),
      await moduleOf('m:one', { 'code/x.cip.js': '/*→ head ←*/\none\n/*→ head ←*/\n' }),
      await moduleOf('m:two', { 'code/x.cip.js': '/*→ head ←*/\ntwo\n/*→ head ←*/\n/*→ nowhere ←*/\nz\n/*→ nowhere ←*/\n' }),
    ] })

    expect(compositions).toHaveLength(1)
    const [composition] = compositions
    expect(composition).toMatchObject({
      target: 'code/x.js',
      main: { from: 'm:main', path: 'code/x.cipmain.js' },
      points: [{ name: 'head', providers: ['m:one', 'm:two'] }, { name: 'tail', providers: [] }],
      unfilled: ['tail'],
      orphans: [{ name: 'nowhere', from: 'm:two' }],
    })
    expect(composition?.spliced).toContain('one')
    expect(composition?.spliced?.indexOf('one')).toBeLessThan(composition?.spliced?.indexOf('two') ?? 0)
    expect(composition?.spliced).not.toContain('→')
  })

  it('tells a fragment that has no main file among the modules, and a block left open', async () => {
    const { compositions } = await describeCips({ modules: [
      await moduleOf('m:one', { 'code/y.cip.vue': '/*→ open ←*/\nx\n' }),
    ] })

    expect(compositions[0]).toMatchObject({ target: 'code/y.vue', fragments: [{ points: [], unclosed: ['open'] }], points: [] })
    expect(compositions[0]?.main).toBeUndefined()
    expect(compositions[0]?.spliced).toBeUndefined()
  })

  it('also finds the points of the configuration, and uses the delimiters a module sets', async () => {
    const { compositions, start } = await describeCips({ modules: [
      await moduleOf('m:main', {
        '.linea/config/config.json': JSON.stringify({ delimiters: [{ extension: ['cip'], start: '<<', end: '>>' }] }),
        '.linea/config/extra.cipmain.js': 'k\n<< p >>\n',
      }),
      await moduleOf('m:one', { '.linea/config/extra.cip.js': '<< p >>\nv\n<< p >>\n' }),
    ] })

    expect(start).toBe('<<')
    expect(compositions[0]).toMatchObject({ target: '.linea/config/extra.js', unfilled: [], points: [{ name: 'p', providers: ['m:one'] }] })
    expect(compositions[0]?.spliced).toContain('v')
  })

  it('leaves out what is not a code insertion point', async () => {
    const { compositions } = await describeCips({ modules: [await moduleOf('m:one', { 'code/plain.js': 'x', 'README.cipmain.md': 'not in code' })] })

    expect(compositions).toEqual([])
  })
})
