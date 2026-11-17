<script setup>
import { ref } from 'vue'
import AutoComplete from 'primevue/autocomplete'

// A list of names (people, labels) to write or to pick from what the repository already has, as GitLab's fields do: typing narrows the
// ones proposed, the arrow opens all of them, and a name that is not among them can still be written (the host says whether it is right).
const model = defineModel({ type: Array, default: () => [] })
const props = defineProps({
  // what the repository has: the ones proposed
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '' },
  name: { type: String, default: undefined },
})

const shown = ref([])
// typing narrows what is proposed; with nothing typed (the arrow), every name that is not chosen yet
const search = ({ query }) => {
  const text = String(query ?? '').trim().toLowerCase()
  shown.value = props.options.filter((option) => !model.value.includes(option) && option.toLowerCase().includes(text))
}

const clean = (values) => [...new Set(values.flatMap((value) => String(value).split(',')).map((value) => value.trim()).filter(Boolean))]
const update = (values) => { model.value = clean(values) }

// Enter or a comma puts what is typed in the list (a name that is not among the proposed ones), instead of sending the form; with a
// proposed name highlighted, Enter chooses that one as the field does.
const onKey = (event) => {
  const input = event.target
  if (input?.tagName !== 'INPUT' || !['Enter', ','].includes(event.key)) return
  if (event.key === 'Enter' && input.getAttribute('aria-activedescendant')) return
  const typed = input.value.replace(/,/g, '').trim()
  if (!typed) return
  event.preventDefault()
  event.stopPropagation()
  model.value = clean([...model.value, typed])
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
</script>

<template>
  <div class="tpick" @keydown.capture="onKey">
    <AutoComplete
      :model-value="model" multiple fluid :suggestions="shown" :dropdown="options.length > 0" dropdown-mode="blank" :force-selection="false"
      add-on-blur :placeholder="placeholder" :input-id="name" :name="name" @update:model-value="update" @complete="search"
    />
  </div>
</template>
