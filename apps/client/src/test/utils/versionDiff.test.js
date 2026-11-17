import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('src/services/productService', () => ({
  default: { getVersion: vi.fn(), getDeployment: vi.fn() },
}))
import productService from 'src/services/productService'
import { EMPTY_DIFF, previousVersionIn, diffOfVersion, diffVersionWithSaved, diffPoints } from 'src/utils/versionDiff'
import { compareVersions } from 'src/utils/versions'

const t = (key, params = {}) => `${key}${params.version ? `:${params.version}` : ''}`

describe('compareVersions', () => {
  it('reads 1.10.0 after 1.9.0', () => {
    expect(['1.10.0', '1.9.0', '0.0.1'].sort(compareVersions)).toEqual(['0.0.1', '1.9.0', '1.10.0'])
  })
})

describe('previousVersionIn', () => {
  it('is the nearest older version of the list, or null for the first', () => {
    expect(previousVersionIn(['0.0.1', '0.1.0', '1.0.0', '0.0.2'], '0.1.0')).toBe('0.0.2')
    expect(previousVersionIn(['0.0.1', '0.1.0'], '0.0.1')).toBeNull()
  })
})

describe('the diffs of the history', () => {
  beforeEach(() => vi.clearAllMocks())

  it('what a version changed is the version against the one before it', async () => {
    productService.getVersion.mockResolvedValue({ spec: { v: 2 }, models: { m: 'b' }, previous: { version: '1.0.0', spec: { v: 1 }, models: { m: 'a' } } })
    const diff = await diffOfVersion({ id: 'p', version: '2.0.0', previous: '1.0.0', t })
    expect(diff).toMatchObject({ open: true, loading: false, before: { v: 1 }, after: { v: 2 }, from: 'v1.0.0', to: 'v2.0.0', models: { deployed: { m: 'a' }, saved: { m: 'b' } } })
  })

  it('the first version is compared with nothing', async () => {
    productService.getVersion.mockResolvedValue({ spec: { v: 1 }, models: null, previous: null })
    const diff = await diffOfVersion({ id: 'p', version: '0.0.1', previous: null, t })
    expect(diff).toMatchObject({ before: { basicData: {}, features: [] }, from: '—', models: null })
  })

  it('a version against what is saved reads the saved spec and models', async () => {
    productService.getVersion.mockResolvedValue({ spec: { v: 1 }, models: { m: 'a' } })
    productService.getDeployment.mockResolvedValue({ saved: { v: 3 }, models: { saved: { m: 'c' } } })
    expect(await diffVersionWithSaved({ id: 'p', version: '1.0.0', t })).toMatchObject({ before: { v: 1 }, after: { v: 3 }, models: { deployed: { m: 'a' }, saved: { m: 'c' } }, from: 'v1.0.0' })
  })

  it('compares any two points, models only when both kept them', async () => {
    productService.getVersion.mockImplementation(async ({ version }) => ({ spec: { version }, models: version === '1.0.0' ? { m: 'a' } : undefined }))
    productService.getDeployment.mockResolvedValue({ saved: { saved: true }, models: { saved: { m: 'c' } } })
    const both = await diffPoints({ id: 'p', from: '1.0.0', to: 'saved', savedPoint: 'saved', t })
    expect(both.models).toEqual({ deployed: { m: 'a' }, saved: { m: 'c' } })
    const one = await diffPoints({ id: 'p', from: '1.0.0', to: '2.0.0', savedPoint: 'saved', t })
    expect(one.models).toBeNull()
  })

  it('has an empty state to start from', () => {
    expect(EMPTY_DIFF).toMatchObject({ open: false, before: null })
  })
})
