<script setup>
import { computed } from 'vue';
import PrimeDialog from 'primevue/dialog';
import Tag from 'primevue/tag';
import Button from 'primevue/button';
import { t } from 'src/i18n/translate';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  products: { type: Array, default: () => [] },
});

const emit = defineEmits(['update:modelValue']);

function getFeatureSet(product) {
  const f = product.spec?.features;
  if (Array.isArray(f)) return new Set(f);
  if (f && typeof f === 'object') return new Set(Object.keys(f).filter((k) => f[k]));
  const sel = product.spec?.selection;
  if (Array.isArray(sel)) return new Set(sel);
  return new Set();
}

const allFeatures = computed(() => {
  const union = new Set();
  for (const p of props.products) for (const f of getFeatureSet(p)) union.add(f);
  return [...union].sort();
});

const matrix = computed(() =>
  allFeatures.value.map((feature) => ({
    feature,
    values: props.products.map((p) => getFeatureSet(p).has(feature)),
    differsAcross: (() => {
      const vals = props.products.map((p) => getFeatureSet(p).has(feature));
      return vals.some((v) => v !== vals[0]);
    })(),
  }))
);

const onlyDiffs = computed(() => matrix.value.filter((r) => r.differsAcross));
const commonFeatures = computed(() => matrix.value.filter((r) => !r.differsAcross && r.values[0]));

const diffCount = computed(() => onlyDiffs.value.length);

function productName(p) {
  return p.spec?.basicData?.name ?? p.name ?? p._id;
}
</script>

<template>
  <PrimeDialog
    :visible="modelValue"
    modal
    :show-header="false"
    :closable="false"
    dismissable-mask
    class="pcm-dialog"
    style="width: 960px; max-width: 96vw"
    :pt="{ content: { style: 'padding: 0; display: flex; flex-direction: column; max-height: calc(100vh - 80px)' } }"
    @update:visible="emit('update:modelValue', $event)"
  >
    <div class="pcm-header">
      <i class="pi pi-clone pcm-header__icon" aria-hidden="true" />
      <div class="pcm-header__title">
        {{ t('labels.product_comparison_title') }}
        <Tag severity="secondary" class="pcm-header__badge">{{ products.length }} {{ t('labels.product_count_badge') }}</Tag>
        <Tag severity="warn" class="pcm-header__badge">{{ diffCount }} {{ t('labels.differences_count_badge') }}</Tag>
      </div>
      <Button
        text
        rounded
        class="pcm-header__close"
        :aria-label="t('labels.close')"
        @click="emit('update:modelValue', false)"
      >
        <template #icon><i class="pi pi-times" /></template>
      </Button>
    </div>

    <div class="pcm-body">
      <table class="pcm__table">
        <thead>
          <tr>
            <th class="pcm__feature-col">{{ t('labels.feature_column_header') }}</th>
            <th v-for="p in products" :key="p._id" class="pcm__product-col">
              <div class="pcm__product-name">{{ productName(p) }}</div>
              <div class="pcm__product-ver">v{{ p.spec?.basicData?.version ?? p.version ?? '?' }}</div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="onlyDiffs.length" class="pcm__section-header">
            <td :colspan="products.length + 1">
              <i class="pi pi-sync pcm__section-icon" aria-hidden="true" />{{ t('labels.differences_section_header') }} ({{ diffCount }})
            </td>
          </tr>
          <tr v-for="row in onlyDiffs" :key="row.feature" class="pcm__diff-row">
            <td class="pcm__feature-cell">{{ row.feature }}</td>
            <td
              v-for="(has, i) in row.values"
              :key="i"
              class="pcm__val-cell"
              :class="has ? 'pcm__val-cell--yes' : 'pcm__val-cell--no'"
            >
              <i :class="has ? 'pi pi-check pcm__icon--ok' : 'pi pi-times pcm__icon--bad'" aria-hidden="true" />
            </td>
          </tr>

          <tr v-if="commonFeatures.length" class="pcm__section-header">
            <td :colspan="products.length + 1">
              <i class="pi pi-check-circle pcm__section-icon" aria-hidden="true" />{{ t('labels.common_features_section_header') }} ({{ commonFeatures.length }})
            </td>
          </tr>
          <tr v-for="row in commonFeatures" :key="row.feature" class="pcm__common-row">
            <td class="pcm__feature-cell">{{ row.feature }}</td>
            <td
              v-for="(has, i) in row.values"
              :key="i"
              class="pcm__val-cell pcm__val-cell--common"
            >
              <i class="pi pi-check pcm__icon--muted" aria-hidden="true" />
            </td>
          </tr>

          <tr v-if="!allFeatures.length">
            <td :colspan="products.length + 1" class="pcm__empty">
              {{ t('labels.no_feature_data_available') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </PrimeDialog>
</template>

<style scoped>

.pcm-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.pcm-header__icon {
  font-size: 20px;
  color: var(--p-primary-color);
}

.pcm-header__title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-heading);
  display: flex;
  align-items: center;
  gap: 8px;
}

.pcm-header__badge {
  font-weight: 500;
}

.pcm-header__close {
  margin-left: auto;
}

.pcm-body {
  overflow: auto;
}

.pcm__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.pcm__table thead tr {
  background: var(--p-content-hover-background);
  position: sticky;
  top: 0;
  z-index: 1;
}

.pcm__feature-col {
  text-align: left;
  padding: 8px 16px;
  font-weight: 600;
  white-space: nowrap;
  width: 220px;
  min-width: 140px;
}

.pcm__product-col {
  text-align: center;
  padding: 6px 12px;
  min-width: 100px;
}

.pcm__product-name {
  font-weight: 600;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.pcm__product-ver {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.pcm__section-header td {
  padding: 6px 16px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-muted-color);
  background: var(--p-surface-ground);
  border-top: 1px solid var(--p-content-border-color);
}

.pcm__section-icon {
  font-size: 13px;
  margin-right: 4px;
}

.pcm__feature-cell {
  padding: 5px 16px;
  color: var(--text-heading);
  font-family: var(--font-mono);
  font-size: 12px;
}

.pcm__val-cell {
  text-align: center;
  padding: 5px 12px;
}

.pcm__diff-row:hover td,
.pcm__common-row:hover td {
  background: var(--p-surface-ground);
}

.pcm__val-cell--yes {
  background: var(--status-ok-soft);
}

.pcm__val-cell--no {
  background: var(--status-bad-soft);
}

.pcm__icon--ok {
  color: var(--status-ok);
  font-size: 16px;
}

.pcm__icon--bad {
  color: var(--status-bad);
  font-size: 16px;
}

.pcm__icon--muted {
  color: var(--p-text-dim-color);
  font-size: 16px;
}

.pcm__empty {
  text-align: center;
  padding: 32px;
  color: var(--p-text-dim-color);
}
</style>
