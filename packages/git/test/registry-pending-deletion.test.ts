import { describe, expect, it, vi } from 'vitest'
import { listRegisteredPackages } from '../src/registry/catalog.js'

const entry = (path: string) => ({ kind: 'module' as const, location: `gitlab:${path}`, name: path.split('/').pop() as string, addedAt: '2026-01-01T00:00:00.000Z' })

describe('listRegisteredPackages', () => {
  it('does not offer a package whose group is scheduled for deletion, and keeps the rest', async () => {
    const catalog = {
      list: vi.fn().mockResolvedValue([
        entry('linea/modules/main-component'),
        entry('linea/modules/core-deletion_scheduled-2364'),
        entry('linea-deletion_scheduled-17/modules/other')
      ]),
      get: vi.fn(),
      add: vi.fn(),
      remove: vi.fn()
    }
    const provider = {
      kind: 'gitlab',
      findRepository: vi.fn().mockImplementation(async ({ path }: { path: string }) => ({ id: 1, name: path.split('/').pop(), path, description: '', webUrl: `https://gitlab/${path}` }))
    }
    const source = { listVersions: vi.fn().mockResolvedValue(['0.3.0']), open: vi.fn(), revision: vi.fn() }

    const listed = await listRegisteredPackages({ provider: provider as never, token: 't', kind: 'module', catalog: catalog as never, source: source as never })

    expect(listed.map((p) => p.location)).toEqual(['gitlab:linea/modules/main-component'])
    // nothing was asked of GitLab for the hidden ones
    expect(source.listVersions).toHaveBeenCalledTimes(1)
    expect(provider.findRepository).toHaveBeenCalledTimes(1)
  })
})
