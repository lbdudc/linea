<template>
  <PrimeDialog
    v-model:visible="dialogValue"
    modal
    :closable="!loading"
    :close-on-escape="false"
    :dismissable-mask="false"
    class="impact-dialog"
    style="width: 900px; max-width: 96vw; overflow: hidden"
    :pt="{
      header: { style: { background: 'var(--p-content-background)', color: 'var(--text-heading)', borderBottom: '1px solid var(--p-content-border-color)' } },
      content: { style: { background: 'var(--p-content-background)' } },
      pcCloseButton: { root: { style: { color: 'var(--p-text-muted-color)' } } },
    }"
  >
    <template #header>
      <div class="impact-dialog__header">
        <i class="pi pi-chart-bar" style="font-size: 18px" aria-hidden="true"></i>
        <span class="impact-dialog__title">{{ $t('labels.impact_analysis') }}</span>
      </div>
    </template>

    <!-- Loading -->
    <div v-if="loading" class="impact-loading">
      <ProgressSpinner
        style="width: 40px; height: 40px"
        class="impact-loading__spinner"
        :dt="{ colorOne: 'var(--p-accent-color)', colorTwo: 'var(--p-accent-color)', colorThree: 'var(--p-accent-color)', colorFour: 'var(--p-accent-color)' }"
      />
      <div class="impact-loading__text">{{ $t('labels.impact_analyzing') }}</div>
    </div>

    <template v-else-if="result">
      <!-- Summary chips -->
      <div class="impact-summary">
        <Tag class="impact-chip impact-chip--bad">
          <template #icon><i class="pi pi-exclamation-circle" style="font-size: 14px; color: var(--p-primary-contrast-color)" aria-hidden="true"></i></template>
          {{ result.summary.breaking }} {{ $t('labels.impact_breaking') }}
        </Tag>
        <Tag class="impact-chip impact-chip--ok">
          <template #icon><i class="pi pi-check-circle" style="font-size: 14px; color: var(--p-primary-contrast-color)" aria-hidden="true"></i></template>
          {{ result.summary.fixing }} {{ $t('labels.impact_fixing') }}
        </Tag>
        <Tag class="impact-chip impact-chip--neutral">
          <template #icon><i class="pi pi-check-circle" style="font-size: 14px; color: var(--p-primary-contrast-color)" aria-hidden="true"></i></template>
          {{ result.summary.unaffected }} {{ $t('labels.impact_unaffected') }}
        </Tag>
      </div>

      <!-- Safe banner -->
      <Message
        v-if="result.summary.breaking === 0 && result.summary.fixing === 0"
        severity="success"
        :closable="false"
        class="impact-banner"
      >
        <template #icon><i class="pi pi-check-circle" style="font-size: 18px" aria-hidden="true"></i></template>
        {{ $t('labels.impact_safe') }}
      </Message>

      <!-- Breaking banner -->
      <Message
        v-else-if="result.summary.breaking > 0"
        severity="error"
        :closable="false"
        class="impact-banner"
      >
        <template #icon><i class="pi pi-exclamation-triangle" style="font-size: 18px" aria-hidden="true"></i></template>
        {{ $t('labels.impact_has_breaking', { n: result.summary.breaking }) }}
      </Message>

      <!-- Products table -->
      <DataTable :value="result.products" data-key="productId" size="small" class="impact-table">
        <Column field="name" :header="$t('labels.name')" />
        <Column field="version" :header="$t('labels.version')" :style="{ width: '80px' }" />
        <Column field="impact" :header="$t('labels.impact_label')" :style="{ textAlign: 'center' }">
          <template #body="{ data }">
            <Tag class="impact-row-chip" :class="`impact-row-chip--${chipColor(data.impact)}`">
              <template #icon><i :class="`pi pi-${chipIcon(data.impact)}`" style="font-size: 13px; color: var(--p-primary-contrast-color)" aria-hidden="true"></i></template>
              {{ impactLabel(data.impact) }}
            </Tag>
          </template>
        </Column>
        <Column field="reason" :header="$t('labels.description')">
          <template #body="{ data }">
            <span v-if="data.reason" class="impact-reason">{{ data.reason }}</span>
            <span v-else-if="data.added?.length" class="impact-reason" data-impact-added>{{ $t('labels.impact_adds', { features: data.added.join(', ') }) }}</span>
            <span v-else class="impact-reason--vacio">—</span>
          </template>
        </Column>
      </DataTable>
    </template>

    <!-- Error -->
    <Message v-else-if="error" severity="error" :closable="false">
      {{ error }}
    </Message>
  </PrimeDialog>
</template>

<script>
import migrationService from 'src/services/migrationService';
import Dialog from 'primevue/dialog';
import ProgressSpinner from 'primevue/progressspinner';
import Tag from 'primevue/tag';
import Message from 'primevue/message';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';

const IMPACT_COLORS = {
  breaking: 'bad',
  fixing: 'ok',
  unaffected_valid: 'neutral',
  unaffected_invalid: 'muted',
};

const IMPACT_ICONS = {
  breaking: 'exclamation-circle',
  fixing: 'check-circle',
  unaffected_valid: 'check',
  unaffected_invalid: 'minus',
};

export default {
  name: 'ImpactAnalysisPanel',

  components: { PrimeDialog: Dialog, ProgressSpinner, Tag, Message, DataTable, Column },

  props: {
    dialog:  { type: Boolean, required: true },
    lineId:  { type: String,  required: true },
    content: { type: String,  required: true },
  },

  emits: ['update:dialog'],

  data() {
    return {
      loading: false,
      result: null,
      error: null,
    };
  },

  computed: {
    dialogValue: {
      get() { return this.dialog; },
      set(v) { this.$emit('update:dialog', v); },
    },
  },

  watch: {
    dialog(opened) {
      if (opened) this.runAnalysis();
    },
  },

  mounted() {
    if (this.dialog) this.runAnalysis();
  },

  methods: {
    async runAnalysis() {
      this.loading = true;
      this.result = null;
      this.error = null;
      try {
        this.result = await migrationService.impact({ lineId: this.lineId, content: this.content });
      } catch (err) {
        this.error = err.response?.data?.error
          ? this.$t(err.response.data.error)
          : err.message;
      } finally {
        this.loading = false;
      }
    },
    // unaffected_valid/invalid share one label; color/icon still differ.
    impactLabel(impact) {
      return impact.startsWith('unaffected') ? this.$t('labels.impact_unaffected') : this.$t('labels.impact_' + impact);
    },
    chipColor(impact) { return IMPACT_COLORS[impact] ?? 'neutral'; },
    chipIcon(impact)  { return IMPACT_ICONS[impact]  ?? 'question-circle'; },
  },
};
</script>

<style scoped lang="scss">
.impact-dialog {
  &__header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__title {
    font-weight: 600;
    font-size: 1.0625rem;
  }
}

.impact-loading {
  text-align: center;
  padding: 24px 0;

  &__spinner { margin-bottom: 16px; }

  &__text {
    font-size: 0.75rem;
    font-weight: 400;
    line-height: 1.667;
    letter-spacing: 0.03333em;
    color: var(--text-muted);
  }
}

.impact-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.impact-banner { margin-bottom: 16px; }
.impact-table  { margin-bottom: 16px; }

.impact-section-title {
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.375;
  letter-spacing: 0.00714em;
  margin-bottom: 4px;
}

.impact-reason {
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.667;
  letter-spacing: 0.03333em;
  color: var(--status-bad);

  &--vacio { color: var(--p-text-faint-color); }
}

.impact-chip,
.impact-row-chip {
  font-variant-numeric: tabular-nums;
}

.impact-chip {
  &--ok       { background: var(--status-ok)         !important; color: var(--status-on-solid) !important; }
  &--bad      { background: var(--status-bad)        !important; color: var(--status-on-solid) !important; }
  &--neutral  { background: var(--status-neutral-solid) !important; color: var(--status-on-solid) !important; }
}

.impact-row-chip {
  &--ok      { background: var(--status-ok)          !important; color: var(--status-on-solid) !important; }
  &--bad     { background: var(--status-bad)         !important; color: var(--status-on-solid) !important; }
  &--neutral { background: var(--status-neutral-solid) !important; color: var(--status-on-solid) !important; }
  &--muted   { background: var(--text-muted)         !important; color: var(--status-on-solid) !important; }
}

.impact-progress {
  margin-bottom: 4px;

  :deep(.p-progressbar-value) {
    background: var(--p-accent-color);
  }
}
</style>
