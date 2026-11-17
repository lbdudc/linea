<script setup>
import { computed, getCurrentInstance, ref } from 'vue'
import PrimeButton from 'primevue/button'
import { openSearch } from 'stores/searchDialog'

const props = defineProps({
  kind: { type: String, default: 'not_found' },
  detail: { type: String, default: '' },
})
const emit = defineEmits(['retry'])

const instance = getCurrentInstance()
const copied = ref(false)

const CODES = { not_found: '404', forbidden: '403', server: '500', offline: '···' }
const code = computed(() => CODES[props.kind] ?? CODES.not_found)
const retryable = computed(() => props.kind === 'server' || props.kind === 'offline')

const route = computed(() => instance.proxy.$route)
const details = computed(() => [
  `${props.kind} ${code.value}`,
  route.value?.fullPath ?? '',
  props.detail,
  new Date().toISOString(),
].filter(Boolean).join('\n'))

const copyWithSelection = () => {
  const field = document.createElement('textarea')
  field.value = details.value
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  try {
    return document.execCommand('copy')
  } finally {
    field.remove()
  }
}

async function copyDetails() {
  let done = false
  try {
    await navigator.clipboard.writeText(details.value)
    done = true
  } catch {
    done = copyWithSelection()
  }
  copied.value = done
  if (done) setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <section class="error-state" :data-error-kind="kind" data-entity-missing>
    <div class="error-state__code">{{ code }}</div>
    <h1 class="error-state__title">{{ $t(`error_state.${kind}_title`) }}</h1>
    <p class="error-state__text">{{ $t(`error_state.${kind}_text`) }}</p>
    <code v-if="$route?.fullPath" class="error-state__path">{{ $route.fullPath }}</code>
    <div class="error-state__actions">
      <PrimeButton v-if="retryable" :label="$t('error_state.retry')" icon="pi pi-refresh" name="error-retry" @click="emit('retry')" />
      <PrimeButton :label="$t('error_state.search')" icon="pi pi-search" severity="secondary" outlined name="error-search" @click="openSearch" />
      <PrimeButton :label="$t('labels.back_to_lines')" severity="secondary" outlined name="error-lines" @click="$router.push('/lines')" />
      <PrimeButton :label="$t('labels.go_home')" :outlined="retryable" name="error-home" @click="$router.push('/')" />
    </div>
    <button type="button" class="error-state__copy" name="error-copy" @click="copyDetails">
      {{ copied ? $t('error_state.copied') : $t('error_state.copy_details') }}
    </button>
  </section>
</template>

<style scoped lang="scss">
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 64px 16px;
  text-align: center;

  &__code { font-size: 5rem; line-height: 1; color: var(--p-text-muted-color); }
  &__title { margin: 0; font-size: 1.5rem; font-weight: 600; }
  &__text { margin: 0; color: var(--p-text-muted-color); max-width: 46ch; }
  &__path { max-width: 100%; overflow-wrap: anywhere; font-size: 0.8125rem; color: var(--p-text-muted-color); }
  &__actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 16px; }
  &__copy {
    margin-top: 8px;
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    font-size: 0.8125rem;
    color: var(--p-primary-color);
    cursor: pointer;
    text-decoration: underline;
  }
}
</style>
