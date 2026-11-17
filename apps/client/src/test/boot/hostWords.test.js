import { describe, it, expect } from 'vitest'
import { createI18n } from 'vue-i18n'
import { applyHostWords, inHostWords } from 'src/boot/hostWords'
import { hostName } from 'src/boot/gitHost'

const make = () =>
  createI18n({
    legacy: true,
    locale: 'en',
    messages: {
      en: { labels: { gitlab: 'GitLab', open_in_gitlab: 'Open in GitLab', open_mrs: 'Open MRs', gitlab_namespace: 'GitLab group' }, log: { created_merge_request: 'Created merge request from <b>{0}</b>' } },
      es: { labels: { open_in_gitlab: 'Abrir en GitLab', gitlab_namespace: 'Grupo de GitLab' }, log: { created_merge_request: 'Se creó una solicitud de fusión desde <b>{0}</b>' } },
    },
  })

describe('the words of the interface for the host in use', () => {
  it('say GitHub, pull request and PRs, in every language, and what a group is', async () => {
    const i18n = make()
    expect(await applyHostWords({ i18n, fetchConfig: async () => ({ hosts: [{ id: 'github' }] }) })).toBe(true)
    expect(i18n.global.t('labels.open_in_gitlab')).toBe('Open in GitHub')
    expect(i18n.global.t('labels.open_mrs')).toBe('Open PRs')
    expect(i18n.global.t('log.created_merge_request', ['x'])).toBe('Created pull request from <b>x</b>')
    expect(i18n.global.t('labels.gitlab_namespace')).toBe('GitHub account or organization')
    i18n.global.locale = 'es'
    expect(i18n.global.t('labels.open_in_gitlab')).toBe('Abrir en GitHub')
    expect(i18n.global.t('log.created_merge_request', ['x'])).toContain('pull request')
  })

  it('name no GitLab when the repositories are LINEA\'s own', async () => {
    const i18n = make()
    await applyHostWords({ i18n, fetchConfig: async () => ({ hosts: [{ id: 'local' }] }) })
    expect(i18n.global.t('labels.open_in_gitlab')).toBe('Open in LINEA')
    expect(i18n.global.t('log.created_merge_request', ['x'])).toBe('Created change request from <b>x</b>')
  })

  it('stay GitLab\'s with GitLab, with several hosts, and with no answer', async () => {
    for (const fetchConfig of [
      async () => ({ hosts: [{ id: 'gitlab' }] }),
      async () => ({ hosts: [{ id: 'gitlab' }, { id: 'github' }] }),
      async () => { throw new Error('down') },
    ]) {
      const i18n = make()
      expect(await applyHostWords({ i18n, fetchConfig })).toBe(false)
      expect(i18n.global.t('labels.open_in_gitlab')).toBe('Open in GitLab')
    }
    expect(inHostWords('gitlab')({ a: 'GitLab' }, 'en')).toEqual({ a: 'GitLab' })
  })

  it('name the host', () => {
    expect(hostName('github')).toBe('GitHub')
    expect(hostName('gitlab')).toBe('GitLab')
    expect(hostName('local')).toBe('LINEA')
    expect(hostName(undefined)).toBe('GitLab')
  })
})

describe('the words follow the profile in use', () => {
  it('change when the person switches remote, and come back to GitLab\'s', async () => {
    const { setProfileWords } = await import('src/boot/hostWords')
    const i18n = make()
    setProfileWords({ i18n, kind: 'github' })
    expect(i18n.global.t('labels.open_in_gitlab')).toBe('Open in GitHub')
    setProfileWords({ i18n, kind: 'local' })
    expect(i18n.global.t('labels.open_in_gitlab')).toBe('Open in LINEA')
    expect(i18n.global.t('log.created_merge_request', ['x'])).toBe('Created change request from <b>x</b>')
    setProfileWords({ i18n, kind: 'gitlab' })
    expect(i18n.global.t('labels.open_in_gitlab')).toBe('Open in GitLab')
    expect(i18n.global.t('labels.gitlab_namespace')).toBe('GitLab group')
  })
})

describe('the page of the git hosts and the locales without labels', () => {
  it('keeps GitLab as GitLab on the page that describes each host', () => {
    const out = inHostWords('github')({ git_hosts: { about_gitlab: 'A GitLab: merge requests' }, other: 'GitLab' }, 'en')
    expect(out.git_hosts.about_gitlab).toBe('A GitLab: merge requests')
    expect(out.other).toBe('GitHub')
  })

  it('gives the host\'s labels to a language that had none', () => {
    const out = inHostWords('github')({ other: 'x' }, 'en')
    expect(out.labels.gitlab_namespace).toBe('GitHub account or organization')
  })
})
