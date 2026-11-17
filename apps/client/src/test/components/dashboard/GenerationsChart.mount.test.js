import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountGlobalPlugins } from 'src/test/mount'
import GenerationsChart from 'src/components/dashboard/GenerationsChart.vue'

function makeDays(n) {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(2026, 8, 26 + i),
    success: 0,
    warning: 0,
    error: 0,
    total: 0,
  }))
}

function mountChart(days, maxTotal) {
  return mount(GenerationsChart, {
    props: { days, maxTotal, loading: false },
    global: { plugins: mountGlobalPlugins() },
  })
}

describe('GenerationsChart', () => {
  it('muestra siempre la leyenda de los tres resultados', () => {
    const wrapper = mountChart(makeDays(7), 0)

    const legendText = wrapper.find('.gen-chart__legend').text()
    expect(legendText).toContain('Sin conflictos')
    expect(legendText).toContain('Con conflictos')
    expect(legendText).toContain('Error')
  })

  it('marca con un punto el día sin generaciones y apila los segmentos del día con datos', () => {
    const days = makeDays(7)
    days[1] = { ...days[1], success: 1, warning: 1, error: 1, total: 3 }

    const wrapper = mountChart(days, 3)
    const cols = wrapper.findAll('.bars__col')
    expect(cols).toHaveLength(7)

    const emptyCol = cols[2]
    expect(emptyCol.classes()).toContain('bars__col--empty')
    expect(emptyCol.find('.bars__dot').exists()).toBe(true)
    expect(emptyCol.find('.bars__stack').exists()).toBe(false)

    const stackedCol = cols[1]
    expect(stackedCol.classes()).not.toContain('bars__col--empty')
    expect(stackedCol.find('.bars__dot').exists()).toBe(false)
    expect(stackedCol.find('.bars__stack').exists()).toBe(true)
    expect(stackedCol.findAll('.bars__segment')).toHaveLength(3)
  })

  it('el rótulo de sección nombra el número de días visibles', () => {
    const wrapper = mountChart(makeDays(14), 0)
    expect(wrapper.find('.gen-chart__title').text()).toContain('14')
  })
})
