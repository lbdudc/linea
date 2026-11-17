import { describe, expect, it } from 'vitest'
import { DEFAULT_PLATFORM_CONFIG, renderChildPipeline } from '../../src/index.js'

describe('renderChildPipeline', () => {
  it('has one job per product: derive, leftovers, determinism, tests', () => {
    const yaml = renderChildPipeline({ products: ['a', 'b c'], specsDir: '.linea-ci/specs' })
    expect(yaml).toContain('product:a:')
    expect(yaml).toContain('product:b_c:')
    expect(yaml).toContain('linea-ci derive --line . --spec .linea-ci/specs/a.json')
    expect(yaml).toContain('linea-ci check-leftovers')
    expect(yaml).toContain('linea-ci check-determinism --line . --spec .linea-ci/specs/a.json')
    expect(yaml).toContain('job: select')
  })

  it('compares with the repository the products that have one listed', () => {
    const yaml = renderChildPipeline({ products: ['a', 'b'], specsDir: 's', repositories: { a: 'g/p/a' } })
    expect(yaml).toContain('linea-ci check-drift --line . --spec s/a.json --repository "g/p/a"')
    expect(yaml).not.toContain('--spec s/b.json --repository')
  })

  it('stops the job when a test script fails', () => {
    expect(renderChildPipeline({ products: ['a'], specsDir: 's' })).toContain('sh "$t" || exit 1')
  })

  it('asks for the runner tags it is given, in every job, and for none by default', () => {
    expect(renderChildPipeline({ products: ['a', 'b'], specsDir: 's', tags: ['deploy'] }).match(/tags: \["deploy"\]/g)).toHaveLength(2)
    expect(renderChildPipeline({ products: [], specsDir: 's', tags: ['deploy'] })).toContain('tags: ["deploy"]')
    expect(renderChildPipeline({ products: ['a'], specsDir: 's' })).not.toContain('tags:')
  })

  it('has a job that says so when nothing is affected', () => {
    expect(renderChildPipeline({ products: [], specsDir: 's' })).toContain('no-products-affected:')
  })

  it('contains no annotation delimiter', () => {
    const yaml = renderChildPipeline({ products: ['a'], specsDir: 's' })
    for (const { start, end } of DEFAULT_PLATFORM_CONFIG.delimiters) {
      expect(yaml.includes(start) || yaml.includes(end)).toBe(false)
    }
  })
})
