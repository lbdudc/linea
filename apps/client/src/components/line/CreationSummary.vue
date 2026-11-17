<script setup>
import { computed } from 'vue'
import PrimeButton from 'primevue/button'
import KindDiagram from './KindDiagram.vue'
import GitHostIcon from 'components/common/GitHostIcon.vue'

/**
 * What is about to be created: the name as the title, what it is (version, kind, where) as chips that take back to the step that edits
 * them, what it is made of as a list, and the drawing of it, big, at the end.
 */
const props = defineProps({
  rows: { type: Array, required: true },
  kind: { type: String, default: 'plain' },
  // what was chosen and the name of the SPL: the drawing shows them
  items: { type: Array, default: () => [] },
  splName: { type: String, default: '' },
})
const emit = defineEmits(['edit'])

const row = (key) => props.rows.find((r) => r.key === key)
const facts = computed(() => ['version', 'type', 'location'].map(row).filter(Boolean))
const contents = computed(() => row('contents') ?? null)
</script>

<template>
  <section class="cs" name="creation-summary">
    <div class="cs__rows">
      <header class="cs__hero" name="summary-details">
        <div class="cs__title-line">
          <h3 class="cs__title">{{ row('details').value }}</h3>
          <PrimeButton text rounded size="small" type="button" icon="pi pi-pencil" :aria-label="`${row('details').label}: ${$t('creation.summary_edit')}`" name="summary-edit-details" @click="emit('edit', row('details').step)" />
        </div>
        <div class="cs__facts">
          <button v-for="fact in facts" :key="fact.key" type="button" class="cs__fact" :name="`summary-edit-${fact.key}`" :title="`${fact.label} · ${$t('creation.summary_edit')}`" @click="emit('edit', fact.step)">
            <GitHostIcon v-if="fact.hostId" :host="fact.hostId" :size="14" />
            <i v-else :class="['pi', fact.icon]" aria-hidden="true" />
            <span class="cs__fact-label">{{ fact.label }}</span>
            <span class="cs__fact-value" :name="`summary-${fact.key}`">{{ fact.value }}</span>
            <i class="pi pi-pencil cs__fact-edit" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div v-if="contents" class="cs__contents" name="summary-contents">
        <div class="cs__contents-head">
          <span class="cs__contents-label"><i :class="['pi', contents.icon]" aria-hidden="true" />{{ contents.label }}</span>
          <PrimeButton text size="small" type="button" :label="$t('creation.summary_edit')" name="summary-edit-contents" @click="emit('edit', contents.step)" />
        </div>
        <ul v-if="contents.chips?.length" class="cs__chips">
          <li v-for="chip in contents.chips" :key="chip.name" class="cs__chip">
            <span class="cs__chip-name">{{ chip.name }}</span>
            <span v-if="chip.range" class="cs__chip-range">{{ chip.range }}</span>
          </li>
        </ul>
        <p v-else class="cs__none">{{ contents.value }}</p>
      </div>
    </div>

    <div class="cs__figure">
      <KindDiagram :kind="kind" :items="items" :spl-name="splName" />
    </div>
  </section>
</template>

<style scoped>
.cs { display: flex; flex-direction: column; gap: 16px; }
.cs__rows { display: flex; flex-direction: column; gap: 12px; }

/* the title: the name of what is being made, with what it is underneath */
.cs__hero { display: flex; flex-direction: column; gap: 12px; padding: 18px 20px; border: 1px solid var(--p-content-border-color); border-radius: 12px; background: linear-gradient(135deg, color-mix(in srgb, var(--p-primary-color) 10%, var(--p-content-background)), var(--p-content-background) 70%); }
.cs__title-line { display: flex; align-items: center; gap: 4px; min-width: 0; }
.cs__title { margin: 0; font-size: 1.5rem; font-weight: 700; letter-spacing: -0.01em; line-height: 1.2; color: var(--text-heading); overflow-wrap: anywhere; }
.cs__facts { display: flex; flex-wrap: wrap; gap: 8px; }
.cs__fact { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; height: 32px; padding: 0 12px; font: inherit; font-size: 13px; color: var(--p-text-color); background: var(--p-content-background); border: 1px solid var(--p-content-border-color); border-radius: 999px; cursor: pointer; transition: border-color 0.15s; }
.cs__fact:hover { border-color: var(--p-primary-color); }
.cs__fact:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 2px; }
.cs__fact > i:first-child { color: var(--p-primary-color); font-size: 13px; }
.cs__fact-label { font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--p-text-muted-color); }
.cs__fact-value { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cs__fact-edit { font-size: 10px; color: var(--p-text-muted-color); opacity: 0; transition: opacity 0.15s; }
.cs__fact:hover .cs__fact-edit, .cs__fact:focus-visible .cs__fact-edit { opacity: 1; }

/* what it is made of: one chip per module or metamodel, with the version it accepts */
.cs__contents { padding: 12px 16px 16px; border: 1px solid var(--p-content-border-color); border-radius: 12px; background: var(--p-content-background); }
.cs__contents-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.cs__contents-label { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--p-text-muted-color); }
.cs__contents-label i { color: var(--p-primary-color); }
.cs__chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.cs__chip { display: inline-flex; align-items: baseline; gap: 8px; padding: 6px 12px; border-radius: 8px; background: var(--p-content-hover-background); border: 1px solid var(--p-content-border-color); }
.cs__chip-name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; font-weight: 600; }
.cs__chip-range { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: var(--p-text-muted-color); }
.cs__none { margin: 0; font-size: 13px; color: var(--p-text-muted-color); }

/* the drawing: the piece of the page, wide, on a faint grid */
.cs__figure { display: flex; align-items: center; justify-content: center; padding: 28px 20px; border: 1px solid var(--p-content-border-color); border-radius: 12px; background-color: var(--p-content-hover-background); background-image: radial-gradient(color-mix(in srgb, var(--p-text-muted-color) 22%, transparent) 1px, transparent 1px); background-size: 16px 16px; }
.cs__figure :deep(svg) { width: 100%; max-width: 720px; }
</style>
