<template>
  <div class="log-item">
    <div class="log-item__icon">
      <i class="pi pi-info-circle" :style="{ color: `var(${colorVars[log.type]})`, fontSize: '34px' }" aria-hidden="true" />
    </div>

    <div class="log-item__content">
      <div class="log-item__message">
        <span v-html="$t(log.message, log.params)"></span>
      </div>
      <div class="log-item__meta">
        {{ formatDate(log.createdAt) }}<template v-if="took"> · <span class="log-item__took" name="log-took">{{ took }}</span></template>
      </div>
      <div v-if="log.link" class="log-item__link">
        <span class="log-item__link-text" @click="handleClick(log.link)">
          {{ $t('labels.open_in_gitlab') }}
        </span>
      </div>
    </div>
  </div>
</template>

<script>
import { formatDate } from 'src/services/utils';
import { formatDuration } from 'src/utils/generationLog';

export default {
  name: 'LogItem',
  props: {
    log: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      colorVars: {
        success: '--status-ok',
        warning: '--status-warn',
        error:   '--status-bad',
        info:    '--p-primary-color',
        cancelled: '--text-muted',
      },
    };
  },
  computed: {
    formatDate() {
      return formatDate;
    },
    took() {
      return formatDuration(this.log.durationMs);
    },
  },
  methods: {
    handleClick(href) {
      window.open(href, '_blank');
    },
  },
};
</script>

<style scoped lang="scss">
.log-item {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 8px 16px;

  &__icon {
    flex-shrink: 0;
    padding-top: 2px;
  }

  &__content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__message {
    font-size: 0.875rem;
    line-height: 1.3;
    color: var(--text-heading);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__meta {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  &__link {
    margin-top: 4px;
    font-size: 0.8125rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--p-primary-color);
  }

  &__link-text {
    cursor: pointer;

    &:hover { text-decoration: underline; }
  }
}
</style>
