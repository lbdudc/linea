import { describe, it, expect } from 'vitest'
import { i18n } from 'src/boot/i18n'

describe('the i18n of the app', () => {
  it('has a global to ask for messages (the production build once renamed it)', () => {
    expect(typeof i18n.global.getLocaleMessage).toBe('function')
    expect(typeof i18n.global.t).toBe('function')
  })
})
