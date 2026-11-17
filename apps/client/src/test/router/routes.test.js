import { describe, it, expect } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import routes from 'src/router/routes'

const router = createRouter({ history: createMemoryHistory(), routes })
const go = async (path) => {
  await router.push(path)
  return router.currentRoute.value
}

describe('the routes of modules and metamodels', () => {
  it('sends the old page of both to the modules, and its selector to the metamodels', async () => {
    expect((await go('/modules')).path).toBe('/packages/modules')
    expect((await go('/modules?kind=metamodel')).path).toBe('/packages/metamodels')
  })

  it('keeps working the links to a package by its kind', async () => {
    expect((await go('/packages/module/12')).path).toBe('/packages/modules/12')
    expect((await go('/packages/metamodel/12')).path).toBe('/packages/metamodels/12')
  })

  it('gives each kind a list and a detail page of its own', async () => {
    for (const path of ['/packages/modules', '/packages/metamodels', '/packages/modules/3', '/packages/metamodels/3']) {
      expect((await go(path)).path).toBe(path)
    }
  })
})
