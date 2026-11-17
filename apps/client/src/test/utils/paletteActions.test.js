import { describe, it, expect, vi } from 'vitest'
import { productActions, accountActions, contextActions, routeContext, isBusy, matchShortcut, SHORTCUTS } from 'src/utils/paletteActions'

const t = (key, params = {}) => `${key}${Object.keys(params).length ? JSON.stringify(params) : ''}`
const handlers = { generate: vi.fn(), sync: vi.fn(), copyAddress: vi.fn(), openHost: vi.fn(), signOut: vi.fn(), account: vi.fn(), sessions: vi.fn(), toggleScheduler: vi.fn(), downloadConfig: vi.fn(), generatePending: vi.fn() }
const product = { _id: 'p1', name: 'GIS-Platform-1', lineId: 'l1', line: 'GIS-Platform', repo: { webUrl: 'https://git.example/gis-1' }, gitHost: 'gitlab' }
const ids = (list) => list.map((action) => action.id)

describe('productActions', () => {
  it('offers generate, sync, copy and open when the product is free', () => {
    const actions = productActions({ product, t, handlers })
    expect(ids(actions)).toEqual([
      'product-action:generate:p1', 'product-action:sync:p1', 'product-action:copy-address:p1', 'product-action:open-host:p1',
    ])
    actions[0].run()
    expect(handlers.generate).toHaveBeenCalledWith(product)
  })

  it('does not offer generate or sync while the product is busy or its line is gone', () => {
    expect(ids(productActions({ product, t, busy: true, handlers }))).toEqual(['product-action:copy-address:p1', 'product-action:open-host:p1'])
    expect(ids(productActions({ product: { ...product, lineDeleted: true }, t, handlers }))).not.toContain('product-action:generate:p1')
  })

  it('puts the failed run first when the last generation failed', () => {
    const actions = productActions({ product, t, lastOutcome: 'error', handlers })
    expect(actions[0]).toMatchObject({ id: 'product-action:failed-run:p1', to: '/cicd?productId=p1&outcome=error' })
    expect(ids(productActions({ product, t, lastOutcome: 'success', handlers }))).not.toContain('product-action:failed-run:p1')
  })

  it('does not offer to open the repository of this server own git host', () => {
    expect(ids(productActions({ product: { ...product, gitHost: 'local' }, t, handlers }))).not.toContain('product-action:open-host:p1')
  })

  it('offers no address when the product has none', () => {
    expect(ids(productActions({ product: { ...product, repo: {} }, t, handlers }))).toEqual(['product-action:generate:p1', 'product-action:sync:p1'])
  })
})

describe('accountActions', () => {
  const build = (extra) => ids(accountActions({ t, isAdmin: false, hasLocalAccount: false, schedulerPaused: false, handlers, ...extra }))

  it('gives everybody sign out and sessions, and the account only to local accounts', () => {
    expect(build()).toEqual(['account:sign-out', 'account:sessions'])
    expect(build({ hasLocalAccount: true })).toEqual(['account:sign-out', 'account:account', 'account:sessions'])
  })

  it('keeps the administrator entries from everybody else', () => {
    expect(build().some((id) => id.startsWith('admin:'))).toBe(false)
    expect(build({ isAdmin: true })).toEqual(expect.arrayContaining(['admin:scheduler', 'admin:download-config', 'admin:add-user', 'admin:new-module', 'admin:new-metamodel']))
  })

  it('shows the state of the scheduler in its row and asks for the opposite', () => {
    const running = accountActions({ t, isAdmin: true, schedulerPaused: false, handlers }).find((a) => a.id === 'admin:scheduler')
    expect(running).toMatchObject({ title: 'palette.act_scheduler_pause', badge: 'scheduler.running' })
    running.run()
    expect(handlers.toggleScheduler).toHaveBeenCalledWith(true)
    const paused = accountActions({ t, isAdmin: true, schedulerPaused: true, handlers }).find((a) => a.id === 'admin:scheduler')
    expect(paused).toMatchObject({ title: 'palette.act_scheduler_resume', badge: 'scheduler.paused' })
  })

  it('hides the scheduler while its state is unknown', () => {
    expect(build({ isAdmin: true, schedulerPaused: null })).not.toContain('admin:scheduler')
  })
})

describe('contextActions', () => {
  const line = { _id: 'l1', name: 'GIS-Platform' }

  it('offers nothing outside a line or a product, but pending products', () => {
    expect(contextActions({ t, handlers })).toEqual([])
  })

  it('jumps to the tabs of the line that is open', () => {
    const actions = contextActions({ t, line, handlers })
    expect(actions.find((a) => a.id === 'context:tab-cicd').to).toBe('/lines/l1?tab=cicd')
    expect(actions.find((a) => a.id === 'context:tab-mrs').to).toBe('/lines/l1?tab=mrs')
    expect(actions.find((a) => a.id === 'context:new-product').to).toBe('/lines/l1/new-product')
  })

  it('jumps to the tabs of the product that is open, and creates products in its line', () => {
    const actions = contextActions({ t, product, handlers })
    expect(actions.find((a) => a.id === 'context:tab-history').to).toBe('/products/p1?tab=history')
    expect(actions.find((a) => a.id === 'context:new-product').to).toBe('/lines/l1/new-product')
  })

  it('lists generate all pending only when something is pending, and hands it the products', () => {
    expect(ids(contextActions({ t, handlers }))).not.toContain('context:generate-pending')
    const action = contextActions({ t, pending: [product], handlers }).find((a) => a.id === 'context:generate-pending')
    expect(action.badge).toBe('1')
    action.run()
    expect(handlers.generatePending).toHaveBeenCalledWith([product])
  })
})

describe('routeContext', () => {
  it('reads the line or product from the address', () => {
    expect(routeContext('/lines/abc')).toEqual({ kind: 'line', id: 'abc' })
    expect(routeContext('/lines/abc/modules')).toEqual({ kind: 'line', id: 'abc' })
    expect(routeContext('/products/xyz')).toEqual({ kind: 'product', id: 'xyz' })
    expect(routeContext('/lines')).toBeNull()
    expect(routeContext('/')).toBeNull()
  })
})

describe('isBusy', () => {
  it('is busy while a sync runs or a generation waits or runs', () => {
    expect(isBusy('p1', { runs: [{ productId: 'p1' }] })).toBe(true)
    expect(isBusy('p1', { jobs: [{ productId: 'p1', status: 'running' }] })).toBe(true)
    expect(isBusy('p1', { jobs: [{ productId: 'p1', status: 'success' }] })).toBe(false)
    expect(isBusy('p2', { runs: [{ productId: 'p1' }] })).toBe(false)
  })
})

describe('matchShortcut', () => {
  it('matches the keys of a shortcut and nothing with other modifiers', () => {
    const event = { code: 'KeyT', altKey: true, shiftKey: true, ctrlKey: false, metaKey: false }
    expect(matchShortcut(event, SHORTCUTS['action:theme'])).toBe(true)
    expect(matchShortcut({ ...event, ctrlKey: true }, SHORTCUTS['action:theme'])).toBe(false)
    expect(matchShortcut({ ...event, shiftKey: false }, SHORTCUTS['action:theme'])).toBe(false)
    expect(matchShortcut(event, SHORTCUTS['action:sidebar'])).toBe(false)
  })
})
