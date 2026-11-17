import { describe, expect, test } from 'vitest'
import { hostDescriptor } from '../src/index.js'

describe('the descriptor of a host', () => {
  test('says what each host is, so that nobody compares names', () => {
    expect(['local', 'gitlab', 'github'].map((kind) => hostDescriptor(kind).label)).toEqual(['LINEA', 'GitLab', 'GitHub'])
    expect(hostDescriptor('local')).toMatchObject({ oauth: false, ownsAccounts: true, pipelines: false, managesMembers: true, groupPerRepository: true })
    for (const kind of ['gitlab', 'github']) {
      expect(hostDescriptor(kind)).toMatchObject({ oauth: true, ownsAccounts: false, pipelines: true, managesMembers: false, groupPerRepository: false })
    }
  })

  test('gives the addresses a terminal needs', () => {
    const config = { provider: 'gitlab' as const, gitlab: { url: 'https://gl' }, github: { webUrl: 'https://gh', apiUrl: 'https://api.gh' }, local: { baseUrl: 'https://x/git' } }
    expect(hostDescriptor('gitlab').endpoints(config as never)).toEqual({ url: 'https://gl' })
    expect(hostDescriptor('github').endpoints(config as never)).toEqual({ webUrl: 'https://gh', apiUrl: 'https://api.gh' })
    expect(hostDescriptor('local').endpoints(config as never)).toEqual({ url: 'https://x/git' })
  })

  test('lays the settings over the configuration, leaving what is not set', () => {
    const base = { provider: 'github' as const, github: { webUrl: 'https://gh', clientId: 'env-id' } }
    const next = hostDescriptor('github').withSettings(base as never, { url: '', clientId: 'ui-id', clientSecret: 's' })
    expect(next.github).toMatchObject({ webUrl: 'https://gh', clientId: 'ui-id', clientSecret: 's' })
    expect(hostDescriptor('local').withSettings({ provider: 'local' }, { dataDir: '/data' }, { baseUrl: 'https://x/git' }).local).toEqual({ dataDir: '/data', baseUrl: 'https://x/git' })
  })
})
