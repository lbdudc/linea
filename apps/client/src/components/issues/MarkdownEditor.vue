<script setup>
import { computed, ref } from 'vue'
import PrimeButton from 'primevue/button'
import Textarea from 'primevue/textarea'
import { useT } from 'src/composables/useT'
import { renderMarkdown } from 'src/utils/markdown'

// A box to write markdown in, as GitLab has it: tabs to write and to preview, and buttons that put the marks around what is selected.
const model = defineModel({ type: String, default: '' })
defineProps({
  rows: { type: Number, default: 8 },
  placeholder: { type: String, default: '' },
  name: { type: String, default: undefined },
})
const t = useT()

const mode = ref('write')
const field = ref(null)
const preview = computed(() => renderMarkdown(model.value))

// wraps the selection (or a word that says what to write) in `before` and `after`, and keeps the cursor on it
const mark = (before, after = before, filler = '') => {
  const el = field.value?.$el ?? field.value
  const value = model.value
  const start = el?.selectionStart ?? value.length
  const end = el?.selectionEnd ?? value.length
  const chosen = value.slice(start, end) || filler
  model.value = `${value.slice(0, start)}${before}${chosen}${after}${value.slice(end)}`
  mode.value = 'write'
  requestAnimationFrame(() => {
    const target = field.value?.$el ?? field.value
    target?.focus()
    target?.setSelectionRange(start + before.length, start + before.length + chosen.length)
  })
}
// puts `prefix` at the start of every selected line
const lines = (prefix) => {
  const el = field.value?.$el ?? field.value
  const value = model.value
  const start = value.lastIndexOf('\n', (el?.selectionStart ?? value.length) - 1) + 1
  const end = el?.selectionEnd ?? value.length
  const block = (value.slice(start, end) || t('issues.editor_item')).split('\n').map((line, i) => `${prefix === '1. ' ? `${i + 1}. ` : prefix}${line}`).join('\n')
  model.value = `${value.slice(0, start)}${block}${value.slice(end)}`
  mode.value = 'write'
}
</script>

<template>
  <div class="mded">
    <div class="mded__bar">
      <div class="mded__tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="mode === 'write'" class="mded__tab" :class="{ 'mded__tab--on': mode === 'write' }" @click="mode = 'write'">{{ $t('issues.write') }}</button>
        <button type="button" role="tab" :aria-selected="mode === 'preview'" class="mded__tab" :class="{ 'mded__tab--on': mode === 'preview' }" @click="mode = 'preview'">{{ $t('issues.preview') }}</button>
      </div>
      <span class="mded__tools" :class="{ 'mded__tools--off': mode === 'preview' }">
        <PrimeButton text rounded size="small" severity="secondary" :aria-label="$t('issues.editor_bold')" :title="$t('issues.editor_bold')" @click="mark('**', '**', $t('issues.editor_text'))"><b>B</b></PrimeButton>
        <PrimeButton text rounded size="small" severity="secondary" :aria-label="$t('issues.editor_italic')" :title="$t('issues.editor_italic')" @click="mark('*', '*', $t('issues.editor_text'))"><i>I</i></PrimeButton>
        <PrimeButton text rounded size="small" severity="secondary" icon="pi pi-code" :aria-label="$t('issues.editor_code')" :title="$t('issues.editor_code')" @click="mark('`', '`', 'code')" />
        <PrimeButton text rounded size="small" severity="secondary" icon="pi pi-link" :aria-label="$t('issues.editor_link')" :title="$t('issues.editor_link')" @click="mark('[', '](https://)', $t('issues.editor_text'))" />
        <span class="mded__sep" aria-hidden="true" />
        <PrimeButton text rounded size="small" severity="secondary" icon="pi pi-list" :aria-label="$t('issues.editor_bullets')" :title="$t('issues.editor_bullets')" @click="lines('- ')" />
        <PrimeButton text rounded size="small" severity="secondary" icon="pi pi-sort-numeric-down" :aria-label="$t('issues.editor_numbers')" :title="$t('issues.editor_numbers')" @click="lines('1. ')" />
      </span>
    </div>
    <Textarea v-if="mode === 'write'" ref="field" v-model="model" class="mded__field" :name="name" :rows="rows" auto-resize fluid :placeholder="placeholder" />
    <div v-else class="mded__preview issue-md" :style="{ minHeight: `${rows * 1.4}rem` }" v-html="preview || `<p>${$t('issues.nothing_to_preview')}</p>`" />
    <div class="mded__foot"><i class="pi pi-hashtag" aria-hidden="true" /> {{ $t('issues.markdown_hint') }}</div>
  </div>
</template>

<style scoped>
.mded { border: 1px solid var(--p-content-border-color); border-radius: 8px; background: var(--p-content-hover-background); overflow: hidden; min-width: 0; }
.mded:focus-within { border-color: var(--p-primary-color); }
.mded__bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 8px; border-bottom: 1px solid var(--p-content-border-color); background: var(--p-content-background); }
.mded__tabs { display: flex; gap: 2px; margin-right: 6px; }
.mded__tab { padding: 6px 10px; border: 0; border-radius: 6px; background: none; font: inherit; font-size: 0.8125rem; color: var(--text-muted); cursor: pointer; }
.mded__tab:hover { color: var(--text-heading); }
.mded__tab--on { color: var(--text-heading); font-weight: 600; background: var(--p-content-hover-background); }
.mded__tools { display: flex; align-items: center; gap: 2px; }
.mded__tools--off { opacity: 0.4; pointer-events: none; }
.mded__sep { width: 1px; height: 18px; margin: 0 4px; background: var(--p-content-border-color); }
.mded__field { display: block; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; background: transparent !important; padding: 12px 14px; font-size: 0.875rem; line-height: 1.55; resize: vertical; }
.mded__preview { padding: 12px 14px; font-size: 0.875rem; line-height: 1.55; overflow-wrap: anywhere; background: var(--p-content-hover-background); }
.mded__foot { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-top: 1px solid var(--p-content-border-color); font-size: 0.75rem; color: var(--text-muted); }
</style>
