<script setup>
import { ref, watch } from 'vue'
import Skeleton from 'primevue/skeleton'
import ChangelogView from 'components/changelog/ChangelogView.vue'

// A changelog that is read when it is opened (or when `load` changes while it is open): `load` is a function that returns it.
const props = defineProps({
  load: { type: Function, required: true },
  label: { type: String, default: '' },
  // starts open (the pin and sync dialogs); the versions list keeps them closed until asked
  open: { type: Boolean, default: false },
  name: { type: String, default: 'changelog' },
})
const emit = defineEmits(['loaded'])

const shown = ref(props.open)
const changelog = ref(null)
const loading = ref(false)
const failed = ref(false)
let sequence = 0

const read = async () => {
  const mine = ++sequence
  loading.value = true
  failed.value = false
  try {
    const result = await props.load()
    if (mine !== sequence) return
    changelog.value = result
    emit('loaded', result)
  } catch {
    if (mine === sequence) { failed.value = true; changelog.value = null; emit('loaded', null) }
  } finally {
    if (mine === sequence) loading.value = false
  }
}

const toggle = () => { shown.value = !shown.value }
// read when opened; a different request is a different `:key` of the panel, so a new `load` function on every render does not read again
watch(shown, (open) => { if (open) read() }, { immediate: true })
</script>

<template>
  <div class="changelog-panel">
    <button type="button" class="changelog-panel__toggle" :name="name" :aria-expanded="shown" @click="toggle">
      <i :class="shown ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" aria-hidden="true" />
      {{ label || $t('changelog.show') }}
    </button>
    <div v-if="shown" class="changelog-panel__body">
      <Skeleton v-if="loading" height="48px" />
      <p v-else-if="failed" class="changelog-panel__quiet" data-test="changelog-failed">{{ $t('changelog.failed') }}</p>
      <ChangelogView v-else-if="changelog" :changelog="changelog" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.changelog-panel__toggle { border: 0; background: transparent; padding: 2px 10px; color: var(--p-primary-color); font: inherit; font-size: 12px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
.changelog-panel__body { padding: 6px 10px 10px 26px; }
.changelog-panel__quiet { margin: 0; font-size: 12px; color: var(--p-text-dim-color); }
</style>
