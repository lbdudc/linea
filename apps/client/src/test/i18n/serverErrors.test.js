import { describe, it, expect } from 'vitest'
import messages from 'src/i18n'

// every `error: 'error_messages.x'` the server sends has to be a message, or the person reads the key
const KEYS = ['git_host_unavailable', 'git_host_settings', 'weak_password', 'username_validation', 'plugin_not_found', 'plugin_disabled', 'plugin_incompatible', 'plugin_state']

describe('the errors of the plugin host', () => {
  for (const [locale, tree] of Object.entries(messages)) {
    it(`have a message in ${locale}`, () => {
      for (const key of KEYS) expect(typeof tree.error_messages[key], key).toBe('string')
    })
  }
})
