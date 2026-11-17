import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import GenerationLogList from 'components/generation/GenerationLogList.vue'

const at = (seconds, extra) => ({
  type: 'info', message: 'log.downloaded_spl', params: [], createdAt: new Date(Date.UTC(2026, 9, 14, 12, 0, seconds)).toISOString(), ...extra,
})

const mountLogs = (logs) => mount(GenerationLogList, { props: { logs }, global: { plugins: mountGlobalPlugins() } })

describe('GenerationLogList', () => {
  it('says there is no record when the version has no log', () => {
    const wrapper = mountLogs([])
    expect(wrapper.find('.genlog__empty').exists()).toBe(true)
    expect(wrapper.find('.genlog__steps').exists()).toBe(false)
  })

  it('shows every step, and how it ended and how long it took', () => {
    const wrapper = mountLogs([
      at(0),
      at(2, { message: 'log.generated_product', params: ['0.1.0'] }),
      at(5, { type: 'success', message: 'log.merged_merge_request', params: ['bigbang', 'main'] }),
    ])

    expect(wrapper.findAll('.genlog__step')).toHaveLength(3)
    expect(wrapper.find('.genlog__chip').classes()).toContain('genlog__chip--success')
    expect(wrapper.find('.genlog__meta').text()).toContain('5.0 s')
  })

  it('takes the last thing that said how it ended as the result', () => {
    const warning = mountLogs([at(0), at(1, { type: 'warning', message: 'log.conflicts_merge_request', params: ['a', 'b'] })])
    expect(warning.find('.genlog__chip').classes()).toContain('genlog__chip--warning')

    const failed = mountLogs([at(0), at(1, { type: 'error', message: 'error_messages.internal_error' })])
    expect(failed.find('.genlog__chip').classes()).toContain('genlog__chip--error')
    expect(failed.find('.genlog__step--error').exists()).toBe(true)
  })

  it('links to GitLab from the step that has a link', () => {
    const wrapper = mountLogs([at(0, { link: 'https://gitlab.example/p/-/merge_requests/1' })])
    const link = wrapper.find('a.genlog__link')
    expect(link.attributes('href')).toBe('https://gitlab.example/p/-/merge_requests/1')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
  })
})
