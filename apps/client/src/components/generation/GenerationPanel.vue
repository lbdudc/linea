<template>
  <Transition name="generation-panel">
    <aside
      v-if="visible"
      class="generation-panel"
      :class="[`generation-panel--${state}`, { 'generation-panel--collapsed': collapsed }]"
      role="status"
      aria-live="polite"
      name="generation-panel"
    >
      <header class="generation-panel__head">
        <i :class="icon" class="generation-panel__icon" aria-hidden="true" />
        <div class="generation-panel__title">
          <span class="generation-panel__name">{{ title }}</span>
          <span v-if="version && state !== 'error'" class="generation-panel__version ident">v{{ version }}</span>
        </div>
        <PrimeButton
          text rounded size="small"
          :icon="collapsed ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
          :aria-label="collapsed ? $t('generation.expand') : $t('generation.collapse')"
          @click="collapsed = !collapsed"
        />
        <PrimeButton
          v-if="!running"
          text rounded size="small"
          icon="pi pi-times"
          :aria-label="$t('labels.close')"
          name="generation-panel-close"
          @click="$emit('close')"
        />
      </header>

      <ProgressBar
        v-if="running"
        mode="indeterminate"
        :show-value="false"
        class="generation-panel__progress"
        style="height: 3px"
      />

      <div v-show="!collapsed" ref="log" class="generation-panel__log">
        <p v-if="!messages.length" class="generation-panel__waiting">
          <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ $t('generation.starting') }}
        </p>
        <LogItem v-for="(log, index) in messages" :key="index" :log="log" />
      </div>
    </aside>
  </Transition>
</template>

<script>
import LogItem from '../common/LogItem.vue';
import Button from 'primevue/button';
import ProgressBar from 'primevue/progressbar';

// A progress card docked to the corner: it does not take the screen, so the product stays usable while it generates.
export default {
  name: 'GenerationPanel',
  components: { LogItem, PrimeButton: Button, ProgressBar },
  props: {
    visible:  { type: Boolean, required: true },
    running:  { type: Boolean, required: true },
    messages: { type: Array,   required: true },
    version:  { type: String,  default: '' },
  },
  emits: ['close'],
  data() {
    return { collapsed: false };
  },
  computed: {
    // The last event that says how it ended decides the card, not the HTTP call.
    outcome() {
      const last = [...this.messages].reverse().find((m) => ['success', 'warning', 'error', 'cancelled'].includes(m.type));
      return last ? last.type : null;
    },
    state() {
      if (this.running) return 'running';
      return this.outcome || 'success';
    },
    icon() {
      return {
        running: 'pi pi-cog pi-spin',
        success: 'pi pi-check-circle',
        warning: 'pi pi-exclamation-triangle',
        error:   'pi pi-times-circle',
        cancelled: 'pi pi-ban',
      }[this.state];
    },
    title() {
      return this.$t(`generation.panel_${this.state}`);
    },
  },
  watch: {
    // A new run opens the card again, even if the previous one was collapsed.
    running(now) {
      if (now) this.collapsed = false;
    },
    'messages.length'() {
      this.$nextTick(() => {
        const el = this.$refs.log;
        if (el) el.scrollTop = el.scrollHeight;
      });
    },
  },
};
</script>

<style scoped lang="scss">
.generation-panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 1100;
  width: 420px;
  max-width: calc(100vw - 32px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--p-content-background);
  color: var(--text-heading);
  border: 1px solid var(--p-content-border-color);
  border-left: 3px solid var(--p-primary-color);
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);

  &--success { border-left-color: var(--status-ok); }
  &--warning { border-left-color: var(--status-warn); }
  &--error   { border-left-color: var(--status-bad); }
  &--cancelled { border-left-color: var(--text-muted); }

  &__head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 12px;
  }

  &__icon { font-size: 1.1rem; }
  &--running &__icon { color: var(--p-primary-color); }
  &--success &__icon { color: var(--status-ok); }
  &--warning &__icon { color: var(--status-warn); }
  &--error   &__icon { color: var(--status-bad); }
  &--cancelled &__icon { color: var(--text-muted); }

  &__title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  &__name {
    font-weight: 600;
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__version {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  &__progress {
    :deep(.p-progressbar-value) { background: var(--p-primary-color); }
  }

  // The log item keeps one line per message; in the panel a long reason (what does not fit the SPL) has to be readable.
  &__log :deep(.log-item__message) {
    white-space: normal;
    overflow-wrap: anywhere;
  }

  &__log {
    max-height: 280px;
    overflow-y: auto;
    border-top: 1px solid var(--p-content-border-color);
    padding: 4px 0;
  }

  &__waiting {
    margin: 0;
    padding: 12px 16px;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
}

.generation-panel-enter-active,
.generation-panel-leave-active { transition: opacity 0.18s, transform 0.18s; }
.generation-panel-enter-from,
.generation-panel-leave-to { opacity: 0; transform: translateY(12px); }

@media (prefers-reduced-motion: reduce) {
  .generation-panel-enter-active,
  .generation-panel-leave-active { transition: none; }
}
</style>
