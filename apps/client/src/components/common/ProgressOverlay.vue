<script setup>
// A full-screen "working on it" card for the actions that take seconds (creating an SPL or a product): a spinning ring around the
// logo, and the steps the server goes through, ticked off as time goes by. The steps are an estimate of the server's work, not its
// real progress: the last one stays active until `active` goes false.
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  active: { type: Boolean, default: false },
  title: { type: String, default: '' },
  hint: { type: String, default: '' },
  steps: { type: Array, default: () => [] },
  // how long each step lasts before the next one is ticked off
  stepMs: { type: Number, default: 1800 },
})

const current = ref(0)
let timer = null

const stop = () => {
  if (timer) clearInterval(timer)
  timer = null
}

watch(() => props.active, (on) => {
  stop()
  current.value = 0
  if (!on) return
  timer = setInterval(() => {
    // the last step waits for the answer
    if (current.value < props.steps.length - 1) current.value += 1
  }, props.stepMs)
}, { immediate: true })

onBeforeUnmount(stop)

const progress = computed(() => (props.steps.length ? Math.round(((current.value + 0.5) / props.steps.length) * 100) : 0))
</script>

<template>
  <Teleport to="body">
    <Transition name="progress-fade">
      <div v-if="active" class="progress-overlay" role="alertdialog" aria-live="polite" aria-busy="true" :aria-label="title">
        <div class="progress-card">
          <div class="progress-card__emblem" aria-hidden="true">
            <span class="progress-card__ring" />
            <span class="progress-card__ring progress-card__ring--slow" />
            <i class="pi pi-cog progress-card__gear" />
          </div>

          <h2 class="progress-card__title">{{ title }}</h2>
          <p v-if="hint" class="progress-card__hint">{{ hint }}</p>

          <div class="progress-card__bar" aria-hidden="true">
            <span class="progress-card__fill" :style="{ width: progress + '%' }" />
          </div>

          <ol class="progress-card__steps">
            <li
              v-for="(step, index) in steps"
              :key="index"
              class="progress-step"
              :class="{ 'progress-step--done': index < current, 'progress-step--current': index === current }"
            >
              <span class="progress-step__mark">
                <i v-if="index < current" class="pi pi-check" />
                <span v-else-if="index === current" class="progress-step__dot" />
              </span>
              <span class="progress-step__label">{{ step }}</span>
            </li>
          </ol>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.progress-overlay {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(7, 12, 24, 0.62);
  backdrop-filter: blur(6px);
}

.progress-card {
  width: min(26rem, 100%);
  padding: 32px 28px 26px;
  border-radius: 16px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  text-align: center;

  &__emblem {
    position: relative;
    width: 84px;
    height: 84px;
    margin: 0 auto 18px;
    display: grid;
    place-items: center;
  }

  &__ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 3px solid transparent;
    border-top-color: var(--p-primary-color, #3b82f6);
    border-right-color: var(--p-primary-color, #3b82f6);
    animation: progress-spin 1.1s linear infinite;

    &--slow {
      inset: 9px;
      border-top-color: transparent;
      border-right-color: transparent;
      border-bottom-color: var(--text-muted);
      border-left-color: var(--text-muted);
      opacity: 0.55;
      animation-duration: 2.4s;
      animation-direction: reverse;
    }
  }

  &__gear {
    font-size: 26px;
    color: var(--p-primary-color, #3b82f6);
    animation: progress-pulse 1.8s ease-in-out infinite;
  }

  &__title {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text-heading);
  }

  &__hint {
    margin: 6px 0 0;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  &__bar {
    height: 4px;
    margin: 20px 0 18px;
    border-radius: 999px;
    background: var(--card-border);
    overflow: hidden;
  }

  &__fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--p-primary-color, #3b82f6), #7dd3fc);
    transition: width 0.9s ease;
  }

  &__steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    text-align: left;
  }
}

.progress-step {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.88rem;
  color: var(--text-muted);
  opacity: 0.55;
  transition: opacity 0.3s ease, color 0.3s ease;

  &--done,
  &--current {
    opacity: 1;
  }

  &--done {
    color: var(--text-heading);
  }

  &--current {
    color: var(--text-heading);
    font-weight: 500;
  }

  &__mark {
    flex: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1.5px solid var(--card-border);
    display: grid;
    place-items: center;
    font-size: 0.65rem;
    transition: background 0.3s ease, border-color 0.3s ease;
  }

  &--done &__mark {
    background: var(--status-ok, #34d399);
    border-color: var(--status-ok, #34d399);
    color: #06251a;
  }

  &--current &__mark {
    border-color: var(--p-primary-color, #3b82f6);
  }

  &__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--p-primary-color, #3b82f6);
    animation: progress-pulse 1.1s ease-in-out infinite;
  }
}

.progress-fade-enter-active,
.progress-fade-leave-active {
  transition: opacity 0.2s ease;
}

.progress-fade-enter-from,
.progress-fade-leave-to {
  opacity: 0;
}

@keyframes progress-spin {
  to { transform: rotate(360deg); }
}

@keyframes progress-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(0.82); opacity: 0.6; }
}

@media (prefers-reduced-motion: reduce) {
  .progress-card__ring,
  .progress-card__gear,
  .progress-step__dot {
    animation: none;
  }

  .progress-card__fill {
    transition: none;
  }
}
</style>
