<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import PrimeButton from 'primevue/button'
import { lineKindOf } from 'src/utils/lineKind'

const props = defineProps({
  lines: { type: Array, default: () => [] },
  products: { type: Array, default: () => [] },
})

const emit = defineEmits(['dismiss'])
const router = useRouter()

const firstLine = computed(() => props.lines[0] ?? null)
const modular = computed(() => props.lines.find((line) => lineKindOf(line).kind === 'modular') ?? null)

const steps = computed(() => [
  { key: 'line', done: props.lines.length > 0, to: '/add' },
  { key: 'modules', done: Boolean(modular.value), to: firstLine.value ? `/lines/${firstLine.value._id}/modules` : '/add', blocked: !firstLine.value },
  { key: 'product', done: props.products.length > 0, to: firstLine.value ? `/lines/${firstLine.value._id}/new-product` : '/add', blocked: !firstLine.value },
  { key: 'generate', done: props.products.some((product) => product.version && product.version !== '0.0.0'), to: props.products.length ? '/products' : '/add', blocked: !props.products.length },
])

const next = computed(() => steps.value.find((step) => !step.done) ?? null)
</script>

<template>
  <section class="first-run" name="first-run-checklist">
    <header class="first-run__head">
      <div>
        <h2 class="first-run__title">{{ $t('onboarding.title') }}</h2>
        <p class="first-run__lead">{{ $t('onboarding.lead') }}</p>
      </div>
      <PrimeButton text size="small" severity="secondary" name="first-run-dismiss" :label="$t('onboarding.dismiss')" @click="emit('dismiss')" />
    </header>
    <ol class="first-run__steps">
      <li
        v-for="step in steps"
        :key="step.key"
        class="first-run__step"
        :class="{ 'first-run__step--done': step.done, 'first-run__step--next': next?.key === step.key }"
      >
        <span class="first-run__mark" aria-hidden="true"><i class="pi" :class="step.done ? 'pi-check' : 'pi-circle'" /></span>
        <span class="first-run__text">
          <strong>{{ $t(`onboarding.step_${step.key}`) }}</strong>
          <small>{{ $t(`onboarding.step_${step.key}_hint`) }}</small>
        </span>
        <PrimeButton
          v-if="!step.done"
          size="small"
          :severity="next?.key === step.key ? undefined : 'secondary'"
          :outlined="next?.key !== step.key"
          :disabled="step.blocked"
          :name="`first-run-${step.key}`"
          :label="$t(`onboarding.action_${step.key}`)"
          @click="router.push(step.to)"
        />
      </li>
    </ol>
  </section>
</template>

<style scoped lang="scss">
.first-run {
  margin: 12px 20px 4px;
  padding: 16px 18px;
  border: 1px solid var(--card-border);
  border-radius: 10px;
  background: var(--surface-alt);

  &__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
  &__title { margin: 0; font-size: 1rem; font-weight: 600; }
  &__lead { margin: 2px 0 0; font-size: 0.8125rem; color: var(--text-muted); }

  &__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }

  &__step {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 0;
    border-top: 1px solid var(--card-border);
    &:first-child { border-top: 0; }
  }

  &__mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    font-size: 0.75rem;
    color: var(--text-muted);
    border: 1px solid var(--card-border);
  }

  &__text { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: 0.875rem; small { color: var(--text-muted); font-size: 0.75rem; } }

  &__step--done {
    .first-run__mark { background: var(--status-ok); border-color: var(--status-ok); color: var(--p-primary-contrast-color); }
    .first-run__text { opacity: 0.7; }
  }

  &__step--next .first-run__mark { border-color: var(--p-primary-color); color: var(--p-primary-color); }
}
</style>
