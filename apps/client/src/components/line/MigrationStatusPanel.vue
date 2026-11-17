<template>
  <PrimeDialog
    v-model:visible="dialogValue"
    modal
    closable
    close-on-escape
    :dismissable-mask="false"
    class="mig-dialog"
    style="width: 860px; max-width: 96vw"
  >
    <template #header>
      <div class="mig-dialog__header">
        <i class="pi pi-sync" aria-hidden="true" />
        <span class="mig-dialog__title">{{ $t('labels.migration_status') }}</span>
      </div>
    </template>

    <!-- Loading state -->
    <div v-if="loading" class="mig-loading">
      <ProgressSpinner
        style="width: 40px; height: 40px"
        class="mig-loading__spinner"
        :dt="{ colorOne: 'var(--p-primary-color)', colorTwo: 'var(--p-primary-color)', colorThree: 'var(--p-primary-color)', colorFour: 'var(--p-primary-color)' }"
      />
      <div class="mig-loading__text">{{ $t('labels.migration_analyzing') }}</div>
    </div>

    <template v-else-if="result">
      <!-- Summary chips -->
      <div class="mig-summary">
        <Tag class="mig-chip mig-chip--ok">
          <template #icon><i class="pi pi-check-circle" style="font-size: 14px; color: var(--p-primary-contrast-color)" aria-hidden="true" /></template>
          {{ result.summary.valid }} {{ $t('labels.migration_valid') }}
        </Tag>
        <Tag class="mig-chip mig-chip--bad">
          <template #icon><i class="pi pi-times-circle" style="font-size: 14px; color: var(--p-primary-contrast-color)" aria-hidden="true" /></template>
          {{ result.summary.invalid }} {{ $t('labels.migration_invalid') }}
        </Tag>
        <Tag class="mig-chip mig-chip--neutral">
          <template #icon><i class="pi pi-box" style="font-size: 14px; color: var(--p-primary-contrast-color)" aria-hidden="true" /></template>
          {{ $t('labels.total') }}: {{ result.summary.total }}
        </Tag>
      </div>

      <!-- No issues -->
      <Message v-if="result.summary.invalid === 0" severity="success" :closable="false" class="mig-mb-md">
        {{ $t('labels.migration_no_issues') }}
      </Message>

      <!-- Products verdict table -->
      <DataTable
        :value="result.products"
        data-key="productId"
        size="small"
        class="mig-mb-md mig-table"
        row-hover
        @row-click="({ data }) => openProduct(data)"
      >
        <Column field="name" :header="$t('labels.name')">
          <template #body="{ data }">
            <a
              class="mig-link"
              :href="`/products/${data.productId}`"
              @click.prevent.stop="openProduct(data)"
            >{{ data.name }}</a>
          </template>
        </Column>
        <Column field="version" :header="$t('labels.version')" :style="{ width: '80px' }">
          <template #body="{ data }">
            <span class="mig-version">{{ data.version }}</span>
          </template>
        </Column>
        <Column field="status" :header="$t('labels.status')" :style="{ textAlign: 'center' }">
          <template #body="{ data }">
            <Tag v-if="data.status === 'invalid'" class="mig-row-chip mig-row-chip--bad">
              <template #icon><i class="pi pi-times-circle" style="font-size: 13px; color: var(--p-primary-contrast-color)" aria-hidden="true" /></template>
              {{ $t('labels.migration_invalid') }}
            </Tag>
            <Tag v-else-if="data.conflictingMRs > 0" class="mig-row-chip mig-row-chip--warn">
              <template #icon><i class="pi pi-code-branch" style="font-size: 13px; color: var(--p-primary-contrast-color)" aria-hidden="true" /></template>
              {{ $t('labels.col_conflicts') }}
            </Tag>
            <Tag v-else class="mig-row-chip mig-row-chip--ok">
              <template #icon><i class="pi pi-check" style="font-size: 13px; color: var(--p-primary-contrast-color)" aria-hidden="true" /></template>
              {{ $t('labels.migration_valid') }}
            </Tag>
          </template>
        </Column>
        <Column field="reason" :header="$t('labels.description')">
          <template #body="{ data }">
            <span v-if="data.reason" class="mig-reason">{{ data.reason }}</span>
            <span v-else-if="data.conflictingMRs > 0" class="mig-conflicts">
              {{ data.conflictingMRs }} {{ $t('labels.conflicts') }}
            </span>
            <span v-else class="mig-empty">—</span>
          </template>
        </Column>
        <Column field="actions" header="" :style="{ textAlign: 'right' }">
          <template #body="{ data }">
            <PrimeButton
              v-if="data.status === 'invalid'"
              text
              class="sync-btn"
              :label="$t('labels.synchronize')"
              :loading="syncingId === data.productId"
              v-tooltip="$t('labels.migration_sync_tooltip')"
              @click.stop="synchronize(data)"
            >
              <template #icon><i class="pi pi-sync" style="font-size: 16px" aria-hidden="true" /></template>
            </PrimeButton>
          </template>
        </Column>
      </DataTable>
    </template>

    <!-- Error state -->
    <Message v-else-if="error" severity="error" :closable="false">
      {{ error }}
    </Message>
  </PrimeDialog>
</template>

<script>
import { notify } from 'src/composables/useNotify';
import migrationService from '../../services/migrationService';
import productService from '../../services/productService';
import Dialog from 'primevue/dialog';
import ProgressSpinner from 'primevue/progressspinner';
import Tag from 'primevue/tag';
import Message from 'primevue/message';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Button from 'primevue/button';
import Tooltip from 'primevue/tooltip';

export default {
  name: 'MigrationStatusPanel',

  components: {
    PrimeDialog: Dialog,
    ProgressSpinner,
    Tag,
    Message,
    DataTable,
    Column,
    PrimeButton: Button,
  },

  directives: { tooltip: Tooltip },

  props: {
    dialog: { type: Boolean, required: true },
    lineId: { type: String, required: true },
  },

  emits: ['update:dialog'],

  data() {
    return {
      loading: false,
      result: null,
      error: null,
      syncingId: null,
    };
  },

  computed: {
    dialogValue: {
      get() { return this.dialog; },
      set(value) { this.$emit('update:dialog', value); },
    },
  },

  watch: {
    dialog(opened) {
      if (opened) this.runAnalysis();
      else this.abortAnalysis();
    },
  },

  mounted() {
    if (this.dialog) this.runAnalysis();
  },

  beforeUnmount() {
    this.abortAnalysis();
  },

  methods: {
    // closing the dialog while it analyses abandons the request: nobody is waiting for the answer
    abortAnalysis() {
      this.controller?.abort();
      this.controller = null;
    },

    async runAnalysis() {
      this.abortAnalysis();
      const controller = (this.controller = new AbortController());
      const { signal } = controller;
      this.loading = true;
      this.result = null;
      this.error = null;

      try {
        const result = await migrationService.status({ lineId: this.lineId, signal });
        // Conflicts are a separate signal (GitLab MR state), merged in for display so the totals match the line's health card: they
        // come with the status of the products, a request for each group of ten instead of one per product.
        const products = result.products ?? [];
        const statuses = {};
        const ids = products.map(p => p.productId);
        const groups = Array.from({ length: Math.ceil(ids.length / 10) }, (_, i) => ids.slice(i * 10, i * 10 + 10));
        await Promise.all(groups.map(group =>
          productService.getProductsStatus({ ids: group, signal })
            .then(found => Object.assign(statuses, found))
            .catch(() => {})
        ));
        if (signal.aborted) return;
        result.products = products.map(p => ({ ...p, conflictingMRs: statuses[p.productId]?.conflicts?.conflictingMRs ?? 0 }));
        const invalid = result.products.filter(p => p.status === 'invalid' || p.conflictingMRs > 0).length;
        result.summary = { ...result.summary, valid: result.products.length - invalid, invalid };
        this.result = result;
      } catch (err) {
        if (signal.aborted) return;
        this.error = err.response?.data?.error
          ? this.$t(err.response.data.error)
          : err.message;
      } finally {
        if (this.controller === controller) {
          this.loading = false;
          this.controller = null;
        }
      }
    },

    // goes to the product, on the tab where its feature selection is edited, and closes the dialog
    openProduct(product) {
      const query = product.status === 'invalid' ? { tab: 'models' } : {};
      this.dialogValue = false;
      this.$router.push({ path: `/products/${product.productId}`, query });
    },

    async synchronize(product) {
      this.syncingId = product.productId;
      try {
        await productService.generateProduct({ id: product.productId });
        notify({
          type: 'positive',
          message: this.$t('generation.no_conflicts'),
          position: 'bottom-right',
        });
      } catch (err) {
        notify({
          type: 'negative',
          message: err.response?.data?.error
            ? this.$t(err.response.data.error)
            : err.message,
          position: 'bottom-right',
        });
      } finally {
        this.syncingId = null;
      }
    },
  },
};
</script>

<style scoped lang="scss">
.mig-dialog__header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;

  i {
    font-size: 16px;
    color: var(--p-text-muted-color);
  }
}

.mig-dialog__title {
  font-weight: 600;
  font-size: 1.0625rem;
  color: var(--text-heading);
}

.mig-loading {
  text-align: center;
  padding: 32px 0;

  &__spinner {
    margin-bottom: 16px;
  }

  &__text {
    font-size: 12px;
    color: var(--text-muted);
  }
}

.mig-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.mig-mb-md {
  margin-bottom: 16px;
}

.mig-mb-xs {
  margin-bottom: 4px;
}

.mig-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-heading);
  margin-bottom: 4px;
}

.mig-recommendations {
  padding: 16px;
}

.mig-reason {
  font-size: 12px;
  color: var(--status-bad);
}

.mig-conflicts {
  font-size: 12px;
  color: var(--status-warn);
}

.mig-empty {
  color: var(--text-muted);
}

.mig-link {
  color: var(--p-primary-color);
  font-weight: 500;
  text-decoration: none;

  &:hover { text-decoration: underline; }
}

:deep(.mig-table .p-datatable-tbody > tr) {
  cursor: pointer;
}

.mig-version {
  font-family: var(--font-mono);
  font-size: 12px;
}

.mig-chip,
.mig-row-chip {
  font-variant-numeric: tabular-nums;
}

.mig-chip {
  &--ok      { background: var(--status-ok)         !important; color: var(--status-on-solid) !important; }
  &--bad     { background: var(--status-bad)         !important; color: var(--status-on-solid) !important; }
  &--neutral { background: var(--status-neutral-solid) !important; color: var(--status-on-solid) !important; }
}

.mig-row-chip {
  &--ok   { background: var(--status-ok)   !important; color: var(--status-on-solid) !important; }
  &--bad  { background: var(--status-bad)  !important; color: var(--status-on-solid) !important; }
  &--warn { background: var(--status-warn) !important; color: var(--status-on-solid) !important; }
}

.sync-btn {
  color: var(--status-warn) !important;
}
</style>

<style lang="scss">

.mig-dialog.p-dialog {
  overflow: hidden;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
}

.mig-dialog .p-dialog-header {
  padding: 14px 16px 14px 20px;
  background: var(--p-content-background);
  color: var(--text-heading);
  border-bottom: 1px solid var(--p-content-border-color);
}

.mig-dialog .p-dialog-content {
  padding: 20px;
  background: var(--p-content-background);
}

.mig-dialog .p-dialog-header-actions .p-button,
.mig-dialog .p-dialog-close-button {
  width: 28px;
  height: 28px;
  border: 0;
  background: transparent;
  color: var(--p-text-muted-color);
}

.mig-dialog .p-dialog-close-button:hover:not(:disabled) {
  background: var(--p-content-hover-background);
  color: var(--p-text-color);
}

.mig-dialog .p-message {
  margin: 0;
}
</style>
