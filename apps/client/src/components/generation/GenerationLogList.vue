<template>
  <div class="genlog" name="generation-log">
    <p v-if="!logs.length" class="genlog__empty">{{ $t('generation.log_empty') }}</p>

    <template v-else>
      <div class="genlog__summary">
        <span class="genlog__chip" :class="`genlog__chip--${outcome}`">
          <i :class="ICONS[outcome]" aria-hidden="true" />
          {{ $t(`generation.log_${outcome}`) }}
        </span>
        <span class="genlog__meta">
          {{ startedAt }}
          <template v-if="duration"> · {{ duration }}</template>
          · {{ $t('generation.log_steps', { n: logs.length }) }}
        </span>
      </div>

      <ol class="genlog__steps">
        <li v-for="(log, index) in logs" :key="index" class="genlog__step" :class="`genlog__step--${log.type}`">
          <span class="genlog__dot"><i :class="ICONS[log.type] ?? ICONS.info" aria-hidden="true" /></span>
          <span class="genlog__text" v-html="$t(log.message, log.params)" />
          <a
            v-if="log.link"
            class="genlog__link"
            :href="log.link"
            target="_blank"
            rel="noopener noreferrer"
          >{{ $t('labels.open_in_gitlab') }}</a>
          <time class="genlog__time" :datetime="new Date(log.createdAt).toISOString()">{{ clock(log.createdAt) }}<template v-if="tookOf(log)"> · <span name="log-took">{{ tookOf(log) }}</span></template></time>
        </li>
      </ol>
    </template>
  </div>
</template>

<script>
import { formatDuration } from 'src/utils/generationLog';

const ICONS = {
  info: 'pi pi-circle-fill',
  success: 'pi pi-check-circle',
  warning: 'pi pi-exclamation-triangle',
  error: 'pi pi-times-circle',
  cancelled: 'pi pi-ban',
};

// How one generation went, step by step: the log of a version, with its result and how long it took.
export default {
  name: 'GenerationLogList',
  props: {
    // [{ type: 'info' | 'success' | 'warning' | 'error', message (an i18n key), params, createdAt, link }], in order
    logs: { type: Array, required: true },
  },
  data() {
    return { ICONS };
  },
  computed: {
    // the last thing that said how it ended decides the result
    outcome() {
      const last = [...this.logs].reverse().find((log) => ['success', 'warning', 'error', 'cancelled'].includes(log.type));
      return last ? last.type : 'info';
    },
    startedAt() {
      const first = this.logs[0]?.createdAt;
      if (!first) return '';
      return new Date(first).toLocaleString(this.$i18n?.locale, { dateStyle: 'medium', timeStyle: 'short' });
    },
    duration() {
      const times = this.logs.map((log) => new Date(log.createdAt).getTime()).filter((t) => Number.isFinite(t));
      if (times.length < 2) return '';
      const ms = Math.max(...times) - Math.min(...times);
      if (ms < 1000) return `${ms} ms`;
      const seconds = ms / 1000;
      return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
    },
  },
  methods: {
    tookOf(log) {
      return formatDuration(log.durationMs);
    },
    clock(value) {
      return new Date(value).toLocaleTimeString(this.$i18n?.locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    },
  },
};
</script>

<style scoped lang="scss">
.genlog {
  padding: 4px 0 8px;

  &__empty { margin: 0; padding: 8px 0; font-size: 0.8125rem; color: var(--text-muted); }

  &__summary {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    padding: 4px 0 10px;
  }

  &__chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 10px;
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: 999px;
    color: var(--text-muted);
    border: 1px solid currentColor;

    &--success { color: var(--status-ok); }
    &--warning { color: var(--status-warn); }
    &--error { color: var(--status-bad); }
    &--cancelled { color: var(--text-muted); }
  }

  &__meta { font-size: 0.75rem; color: var(--text-muted); font-variant-numeric: tabular-nums; }

  &__steps {
    list-style: none;
    margin: 0;
    padding: 0 0 0 4px;
    display: flex;
    flex-direction: column;
    position: relative;

    // the line the steps hang from
    &::before {
      content: '';
      position: absolute;
      left: 13px;
      top: 10px;
      bottom: 10px;
      width: 1px;
      background: var(--p-content-border-color);
    }
  }

  &__step {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) auto auto;
    align-items: baseline;
    gap: 8px;
    padding: 4px 0;
    font-size: 0.8125rem;
    color: var(--text-heading);
  }

  &__dot {
    position: relative;
    display: inline-flex;
    justify-content: center;
    background: var(--p-content-background);
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  &__step--info &__dot i { font-size: 0.4rem; color: var(--p-primary-color); }
  &__step--success &__dot { color: var(--status-ok); }
  &__step--warning &__dot { color: var(--status-warn); }
  &__step--error &__dot { color: var(--status-bad); }
  &__step--error &__text { color: var(--status-bad); }

  &__text { min-width: 0; overflow-wrap: anywhere; line-height: 1.4; }

  &__link {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--p-primary-color);
    white-space: nowrap;
    text-decoration: none;

    &:hover { text-decoration: underline; }
  }

  &__time {
    font-size: 0.6875rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
}
</style>
