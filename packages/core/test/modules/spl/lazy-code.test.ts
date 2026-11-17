import { describe, expect, it } from 'vitest'
import { planPlatform } from '../../../src/index.js'
import type { PackageFiles, ResolvedSpl } from '../../../src/modules/types.js'
import { filesOf, loadFixture, resolveFixtureData } from '../helpers.js'

const CORE = 'file:modules/core'
const UM = 'file:modules/user-management'
const marker = (name: string): string => `/*→ ${name} ←*/`

type Files = Record<string, string | Uint8Array>

/** The same SPL with every read of a file under `code/` counted, and the files `prefetch` was asked about. */
const counted = (resolved: ResolvedSpl): { resolved: ResolvedSpl, codeReads: string[] } => {
  const codeReads: string[] = []
  const wrap = (files: PackageFiles): PackageFiles => ({
    ...files,
    read: (args) => {
      if (args.path.startsWith('code/')) codeReads.push(args.path)
      return files.read(args)
    }
  })
  return { resolved: { ...resolved, modules: resolved.modules.map((module) => ({ ...module, files: wrap(module.files) })) }, codeReads }
}

const build = async (change: (core: Files, um: Files) => void) => {
  const fixture = loadFixture()
  change(filesOf(fixture, CORE), filesOf(fixture, UM))
  return resolveFixtureData(fixture)
}

describe('planPlatform without loading the code (a check)', () => {
  const bulk = (core: Files, um: Files): void => {
    for (let i = 0; i < 40; i++) core[`code/client/core-${i}.js`] = `core ${i}\n`
    for (let i = 0; i < 40; i++) um[`code/client/um-${i}.js`] = `um ${i}\n`
  }

  it('reads none of the files that only one package provides, and says the same as when it reads them all', async () => {
    const { resolved, spl } = await build(bulk)
    const lazy = counted(resolved)
    const eager = counted(resolved)

    const checked = await planPlatform({ resolved: lazy.resolved, spl, loadCode: false })
    const full = await planPlatform({ resolved: eager.resolved, spl })

    expect(eager.codeReads.length).toBeGreaterThanOrEqual(80)
    expect(lazy.codeReads).toEqual([])
    expect(checked.diagnostics).toEqual(full.diagnostics)
    expect(checked.featureModel).toBe(full.featureModel)
    // the same files are there, only without their bytes
    expect([...checked.files.keys()].sort()).toEqual([...full.files.keys()].sort())
    expect(checked.files.get('src/platform/code/client/core-3.js')?.from).toBe(CORE)
  })

  it('reads only the files two packages both provide, to tell a clash from the same content', async () => {
    const { resolved, spl } = await build((core, um) => {
      bulk(core, um)
      core['code/shared/same.js'] = 'identical\n'
      um['code/shared/same.js'] = 'identical\n'
      core['code/shared/clash.js'] = 'from core\n'
      um['code/shared/clash.js'] = 'from um\n'
    })
    const lazy = counted(resolved)
    const eager = counted(resolved)

    const checked = await planPlatform({ resolved: lazy.resolved, spl, loadCode: false })
    const full = await planPlatform({ resolved: eager.resolved, spl })

    expect([...lazy.codeReads].sort()).toEqual(['code/shared/clash.js', 'code/shared/clash.js', 'code/shared/same.js', 'code/shared/same.js'])
    expect(checked.diagnostics).toEqual(full.diagnostics)
    expect(checked.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringMatching(/clash\.js is also provided by/) as string }))
  })

  it('still reads the files of a code insertion point, and reports what the full plan reports', async () => {
    const { resolved, spl } = await build((core, um) => {
      bulk(core, um)
      core['code/client/menu.cipmain.vue'] = `<ul>\n${marker('menu')}\n</ul>\n`
      um['code/client/menu.cip.vue'] = `${marker('menu')}\n<li>users</li>\n${marker('menu')}\n`
      // the file the splice makes is also provided as a plain file by another package: an error
      um['code/client/menu.vue'] = 'plain\n'
    })
    const lazy = counted(resolved)
    const eager = counted(resolved)

    const checked = await planPlatform({ resolved: lazy.resolved, spl, loadCode: false })
    const full = await planPlatform({ resolved: eager.resolved, spl })

    expect(checked.diagnostics).toEqual(full.diagnostics)
    expect(checked.diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/made from a code insertion point/) as string }))
    expect(lazy.codeReads.sort()).toEqual(['code/client/menu.cip.vue', 'code/client/menu.cipmain.vue'])
  })

  it('names the fixed files of a module up front, and the code only when it is going to be read', async () => {
    const { resolved, spl } = await build(bulk)
    const asked: string[][] = []
    const hinted: ResolvedSpl = {
      ...resolved,
      modules: resolved.modules.map((module) => ({ ...module, files: { ...module.files, prefetch: (paths: string[]) => void asked.push(paths) } }))
    }

    await planPlatform({ resolved: hinted, spl, loadCode: false })
    expect(asked.flat().some((path) => path.startsWith('code/'))).toBe(false)
    expect(asked.flat()).toContain('.linea/model.uvl')

    asked.length = 0
    await planPlatform({ resolved: hinted, spl })
    expect(asked.flat().some((path) => path.startsWith('code/'))).toBe(true)
  })

  it('reads the files that decide something side by side, and reports in the order the code was listed', async () => {
    const { resolved, spl } = await build((core, um) => {
      for (let i = 0; i < 12; i++) {
        core[`code/shared/clash-${i}.js`] = `core ${i}
`
        um[`code/shared/clash-${i}.js`] = `um ${i}
`
      }
    })
    let running = 0
    let peak = 0
    const slow = (files: PackageFiles): PackageFiles => ({
      ...files,
      read: async (args) => {
        running++
        peak = Math.max(peak, running)
        await new Promise((resolve) => setTimeout(resolve, 5))
        running--
        return files.read(args)
      }
    })
    const checked = await planPlatform({ resolved: { ...resolved, modules: resolved.modules.map((module) => ({ ...module, files: slow(module.files) })) }, spl, loadCode: false })
    const full = await planPlatform({ resolved, spl })

    expect(peak).toBeGreaterThan(1)
    expect(checked.diagnostics.map((d) => d.file)).toEqual(Array.from({ length: 12 }, (_, i) => `code/shared/clash-${i}.js`).sort())
    expect(checked.diagnostics).toEqual(full.diagnostics)
  })
})
