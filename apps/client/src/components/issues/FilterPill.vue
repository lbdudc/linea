<script setup>
import { computed, nextTick, ref } from 'vue'
import Popover from 'primevue/popover'

const model = defineModel({ type: [String, Array, null], default: null })
const props = defineProps({
  label: { type: String, required: true },
  options: { type: Array, default: () => [] },
  multiple: { type: Boolean, default: false },
  clearable: { type: Boolean, default: true },
  custom: { type: Boolean, default: false },
  name: { type: String, default: undefined },
  searchPlaceholder: { type: String, default: '' },
})

const popover = ref(null)
const open = ref(false)
const query = ref('')
const searchEl = ref(null)
const onShow = () => { open.value = true; nextTick(() => searchEl.value?.focus()) }

const items = computed(() => props.options.map((option) => (typeof option === 'string' ? { value: option, label: option } : option)))
const selected = computed(() => (props.multiple ? model.value ?? [] : model.value ? [model.value] : []))
const active = computed(() => selected.value.length > 0)
const shown = computed(() => items.value.filter((item) => !query.value.trim() || item.label.toLowerCase().includes(query.value.trim().toLowerCase())))
const labelOf = (value) => items.value.find((item) => item.value === value)?.label ?? value
const summary = computed(() => {
  if (!active.value) return ''
  const [first, ...rest] = selected.value
  return `${labelOf(first)}${rest.length ? ` +${rest.length}` : ''}`
})
const canAddQuery = computed(() => props.custom && query.value.trim() && !items.value.some((item) => item.label.toLowerCase() === query.value.trim().toLowerCase()))

const toggle = (event) => { popover.value?.toggle(event) }
const choose = (value) => {
  if (props.multiple) {
    model.value = selected.value.includes(value) ? selected.value.filter((entry) => entry !== value) : [...selected.value, value]
    return
  }
  model.value = value === model.value && props.clearable ? null : value
  popover.value?.hide()
}
const addQuery = () => {
  const typed = query.value.trim()
  if (!typed) return
  choose(typed)
  query.value = ''
}
const onEnter = () => {
  if (shown.value.length === 1 && !canAddQuery.value) { choose(shown.value[0].value); query.value = ''; return }
  if (canAddQuery.value) addQuery()
}
const clear = () => { model.value = props.multiple ? [] : null }
</script>

<template>
  <span class="fpill" :class="{ 'fpill--active': active, 'fpill--open': open }">
    <button type="button" class="fpill__main" :name="name" aria-haspopup="listbox" :aria-expanded="open" @click="toggle">
      <span class="fpill__label">{{ label }}</span>
      <span v-if="active" class="fpill__value">{{ summary }}</span>
      <i v-if="!active || !clearable" class="pi pi-angle-down fpill__caret" aria-hidden="true" />
    </button>
    <button v-if="active && clearable" type="button" class="fpill__clear" :name="name ? `${name}-clear` : undefined" :aria-label="$t('filters.clear_one', { name: label })" @click="clear">
      <i class="pi pi-times" aria-hidden="true" />
    </button>
    <Popover ref="popover" class="fpill__popover" @show="onShow" @hide="open = false; query = ''">
      <div class="fpill__panel">
        <input v-if="items.length > 6 || custom" ref="searchEl" v-model="query" class="fpill__search" type="search" :name="name ? `${name}-search` : undefined" :placeholder="searchPlaceholder || $t('filters.search')" :aria-label="label" @keydown.enter.prevent="onEnter">
        <ul class="fpill__list" role="listbox" :aria-multiselectable="multiple">
          <li v-for="item in shown" :key="item.value" role="option" :aria-selected="selected.includes(item.value)">
            <button type="button" class="fpill__item" :class="{ 'fpill__item--on': selected.includes(item.value) }" @click="choose(item.value)">
              <i class="pi fpill__tick" :class="selected.includes(item.value) ? 'pi-check' : ''" aria-hidden="true" />
              <span v-if="item.color" class="fpill__dot" :style="{ background: item.color }" />
              <span class="fpill__text">{{ item.label }}</span>
            </button>
          </li>
          <li v-if="canAddQuery"><button type="button" class="fpill__item" @click="addQuery"><i class="pi pi-plus fpill__tick" aria-hidden="true" /><span class="fpill__text">{{ $t('filters.use', { value: query.trim() }) }}</span></button></li>
          <li v-if="!shown.length && !canAddQuery" class="fpill__none">{{ $t('filters.none') }}</li>
        </ul>
      </div>
    </Popover>
  </span>
</template>

<style scoped>
.fpill { display: inline-flex; align-items: center; height: 30px; border: 1px dashed var(--card-border); border-radius: 15px; background: var(--card-bg); color: var(--text-heading); font-size: 0.8125rem; max-width: 100%; }
.fpill--active { border-style: solid; border-color: color-mix(in srgb, var(--p-primary-color) 45%, transparent); background: color-mix(in srgb, var(--p-primary-color) 10%, var(--card-bg)); }
.fpill--open { border-style: solid; border-color: var(--p-primary-color); }
.fpill__main { display: inline-flex; align-items: center; gap: 6px; height: 100%; padding: 0 12px; background: none; border: 0; border-radius: 15px; color: inherit; font: inherit; cursor: pointer; min-width: 0; }
.fpill--active .fpill__main { padding-right: 6px; }
.fpill__main:focus-visible, .fpill__clear:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 1px; }
.fpill__label { color: var(--text-muted); white-space: nowrap; }
.fpill--active .fpill__label::after { content: ':'; }
.fpill__value { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 12rem; }
.fpill__caret { font-size: 0.625rem; color: var(--text-muted); }
.fpill__clear { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; margin-right: 3px; padding: 0; background: none; border: 0; border-radius: 50%; color: var(--text-muted); cursor: pointer; }
.fpill__clear:hover { background: var(--p-content-hover-background); color: var(--text-heading); }
.fpill__clear .pi { font-size: 0.6875rem; }
.fpill__panel { display: flex; flex-direction: column; gap: 6px; min-width: 14rem; max-width: 80vw; }
.fpill__search { height: 30px; box-sizing: border-box; padding: 0 8px; border: 1px solid var(--card-border); border-radius: 6px; background: var(--card-bg); color: var(--text-heading); font: inherit; font-size: 0.8125rem; }
.fpill__list { list-style: none; margin: 0; padding: 0; max-height: 15rem; overflow-y: auto; display: flex; flex-direction: column; }
.fpill__item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px; background: none; border: 0; border-radius: 4px; color: var(--text-heading); font: inherit; font-size: 0.8125rem; text-align: left; cursor: pointer; }
.fpill__item:hover, .fpill__item--on { background: var(--p-content-hover-background); }
.fpill__tick { width: 0.875rem; font-size: 0.75rem; color: var(--p-primary-color); }
.fpill__dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.fpill__text { overflow-wrap: anywhere; }
.fpill__none { padding: 8px; color: var(--text-muted); font-size: 0.8125rem; }
</style>
