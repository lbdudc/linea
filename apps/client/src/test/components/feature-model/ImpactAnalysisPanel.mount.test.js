import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'

vi.mock('src/boot/ws', () => ({
  socket: { on: () => {}, off: () => {} },
}))

import ImpactAnalysisPanel from 'components/feature-model/ImpactAnalysisPanel.vue'

function mountPanel() {
  return mount(ImpactAnalysisPanel, {
    props: { dialog: false, lineId: 'line-1', content: '' },
    global: { plugins: mountGlobalPlugins() },
  })
}

describe('ImpactAnalysisPanel — impactLabel() resuelve claves i18n reales', () => {
  it('breaking / fixing resuelven a su propia clave, no a la clave sin traducir', () => {
    const wrapper = mountPanel()

    const breaking = wrapper.vm.impactLabel('breaking')
    const fixing = wrapper.vm.impactLabel('fixing')

    expect(breaking).toBe(wrapper.vm.$t('labels.impact_breaking'))
    expect(breaking).not.toBe('labels.impact_breaking')
    expect(fixing).toBe(wrapper.vm.$t('labels.impact_fixing'))
    expect(fixing).not.toBe('labels.impact_fixing')
  })

  it('unaffected_valid y unaffected_invalid comparten la clave "impact_unaffected", no una por sufijo', () => {
    const wrapper = mountPanel()

    const expected = wrapper.vm.$t('labels.impact_unaffected')

    expect(wrapper.vm.impactLabel('unaffected_valid')).toBe(expected)
    expect(wrapper.vm.impactLabel('unaffected_invalid')).toBe(expected)
    expect(wrapper.vm.impactLabel('unaffected_valid')).not.toBe('labels.impact_unaffected_valid')
  })

  it('chipIcon/chipColor tienen un valor por defecto para un impact desconocido', () => {
    const wrapper = mountPanel()

    expect(wrapper.vm.chipIcon('algo-que-no-existe')).toBe('question-circle')
    expect(wrapper.vm.chipColor('algo-que-no-existe')).toBe('neutral')
  })
})
