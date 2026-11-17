<script setup>
import PrimeButton from 'primevue/button'

// One field of the side bar of an issue, as GitLab shows it: a bold title with "Edit" at its end, and under it what it holds. Open for
// editing it shows the editor given in the `editor` slot; a form that is always editing gives `always` and has no link.
defineProps({
  title: { type: String, required: true },
  editing: { type: Boolean, default: false },
  always: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false },
})
defineEmits(['edit', 'apply', 'cancel'])
</script>

<template>
  <section class="sfield">
    <header class="sfield__head">
      <h4 class="sfield__title">{{ title }}</h4>
      <button v-if="!always && !readonly && !editing" type="button" class="ln-link sfield__edit" @click="$emit('edit')">{{ $t('issues.edit') }}</button>
      <button v-else-if="editing && !always" type="button" class="ln-link sfield__edit" @click="$emit('cancel')">{{ $t('labels.cancel') }}</button>
    </header>
    <div v-if="editing || always" class="sfield__editor"><slot name="editor" /></div>
    <div v-if="!(editing || always)" class="sfield__value"><slot /></div>
    <div v-if="editing && !always" class="sfield__apply">
      <PrimeButton size="small" :label="$t('issues.apply')" :loading="saving" @click="$emit('apply')" />
    </div>
  </section>
</template>

<style scoped>
.sfield { padding: 14px 0; border-top: 1px solid var(--card-border); min-width: 0; }
.sfield:first-child { border-top: 0; padding-top: 0; }
.sfield__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.sfield__title { margin: 0; font-size: 0.875rem; font-weight: 700; color: var(--text-heading); }
.sfield__edit { font-size: 0.8125rem; font-weight: 500; }
.sfield__value { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-size: 0.875rem; color: var(--text-muted); min-width: 0; }
.sfield__editor { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.sfield__apply { margin-top: 8px; }
</style>
