import { describe, it, expect, vi, beforeEach } from 'vitest'

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }))
vi.mock('src/composables/useNotify', () => ({ notify, errorMessage: (e) => e.message }))

import { offerRollbackUndo } from 'src/composables/useRollbackUndo'

const t = (key, args) => `${key}${args ? JSON.stringify(args) : ''}`

describe('offerRollbackUndo', () => {
  beforeEach(() => notify.mockReset())

  it('offers nothing when it is not known which version was left', () => {
    offerRollbackUndo({ t, leftVersion: null, restore: vi.fn(), again: vi.fn() })
    expect(notify).not.toHaveBeenCalled()
  })

  it('undoes the rollback by restoring the version that was left and generating it again', async () => {
    const restore = vi.fn().mockResolvedValue(true)
    const again = vi.fn()
    offerRollbackUndo({ t, leftVersion: '0.0.2', restore, again })
    const { action } = notify.mock.calls[0][0]
    await action.handler()
    expect(restore).toHaveBeenCalledWith('0.0.2')
    expect(again).toHaveBeenCalledTimes(1)
  })

  it('does not generate again when the restore did not happen', async () => {
    const again = vi.fn()
    offerRollbackUndo({ t, leftVersion: '0.0.2', restore: vi.fn().mockResolvedValue(false), again })
    await notify.mock.calls[0][0].action.handler()
    expect(again).not.toHaveBeenCalled()
  })

  it('says what failed and does not generate again', async () => {
    const again = vi.fn()
    offerRollbackUndo({ t, leftVersion: '0.0.2', restore: vi.fn().mockRejectedValue(new Error('boom')), again })
    await notify.mock.calls[0][0].action.handler()
    expect(notify.mock.calls[1][0]).toMatchObject({ type: 'negative', message: 'boom' })
    expect(again).not.toHaveBeenCalled()
  })
})
