import { computed, ref } from 'vue'
import { defaultTemplate, withTemplate } from 'src/utils/templates'

export const useTemplatePicker = ({ templates, description, preload }) => {
  const chosen = ref(null)
  const list = computed(() => templates() ?? [])
  const current = () => list.value.find((template) => template.name === chosen.value) ?? null

  const choose = (name) => {
    const next = list.value.find((template) => template.name === name) ?? null
    description.value = withTemplate({ description: description.value, previous: current(), next })
    chosen.value = next?.name ?? null
  }

  if (preload) {
    const initial = defaultTemplate(list.value)
    if (initial && !description.value.trim()) choose(initial.name)
  }

  return { chosen, choose, list }
}
