<template>
  <PrimeDialog
    v-model:visible="dialogValue"
    modal
    :closable="phase !== 'saving'"
    :close-on-escape="false"
    :dismissable-mask="false"
    class="save-dialog"
    style="width: 900px; max-width: 96vw; overflow: hidden"
    :pt="{
      header: { style: { background: 'var(--p-content-background)', color: 'var(--text-heading)', borderBottom: '1px solid var(--p-content-border-color)' } },
      content: { style: { background: 'var(--p-content-background)' } },
      pcCloseButton: { root: { style: { color: 'var(--p-text-muted-color)' } } },
    }"
  >
    <template #header>
      <div class="save-dialog__header">
        <i class="pi pi-cloud-upload" style="font-size: 18px" aria-hidden="true"></i>
        <span class="save-dialog__title">{{ $t('labels.save_dialog_title') }}</span>
      </div>
    </template>

    <!-- Checking products -->
    <div v-if="phase === 'checking'" class="save-loading">
      <ProgressSpinner
        style="width: 40px; height: 40px"
        class="save-loading__spinner"
        :dt="{ colorOne: 'var(--p-accent-color)', colorTwo: 'var(--p-accent-color)', colorThree: 'var(--p-accent-color)', colorFour: 'var(--p-accent-color)' }"
      />
      <div class="save-loading__text">{{ $t('labels.save_checking_products') }}</div>
    </div>

    <!-- Review: check result, awaiting confirmation to commit -->
    <template v-else-if="phase === 'review' && checkResult">
      <div class="save-summary">
        <Tag class="save-chip save-chip--bad">
          <template #icon><i class="pi pi-exclamation-circle" style="font-size: 14px; color: var(--p-primary-contrast-color)" aria-hidden="true"></i></template>
          {{ checkResult.summary.breaking }} {{ $t('labels.impact_breaking') }}
        </Tag>
        <Tag class="save-chip save-chip--ok">
          <template #icon><i class="pi pi-check-circle" style="font-size: 14px; color: var(--p-primary-contrast-color)" aria-hidden="true"></i></template>
          {{ checkResult.summary.fixing }} {{ $t('labels.impact_fixing') }}
        </Tag>
        <Tag class="save-chip save-chip--neutral">
          <template #icon><i class="pi pi-check-circle" style="font-size: 14px; color: var(--p-primary-contrast-color)" aria-hidden="true"></i></template>
          {{ checkResult.summary.unaffected }} {{ $t('labels.impact_unaffected') }}
        </Tag>
      </div>

      <div class="save-bump" name="save-bump">
        <span class="save-bump__label">{{ $t('labels.save_version_label') }}</span>
        <span class="save-bump__from ident">v{{ previousVersion }}</span>
        <i class="pi pi-arrow-right save-bump__arrow" aria-hidden="true"></i>
        <span class="save-bump__to ident">v{{ nextVersion }}</span>
        <SelectButton
          v-model="bump"
          :options="bumpChoices"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          name="save-bump-choice"
        />
      </div>
      <p class="save-bump__hint">{{ $t(`generation.bump_${bump}_desc`) }}</p>

      <Message
        v-if="checkResult.summary.breaking === 0 && checkResult.summary.fixing === 0"
        severity="success"
        :closable="false"
        class="save-banner"
      >
        <template #icon><i class="pi pi-check-circle" style="font-size: 18px" aria-hidden="true"></i></template>
        {{ $t('labels.impact_safe') }}
      </Message>
      <Message
        v-else-if="checkResult.summary.breaking > 0"
        severity="error"
        :closable="false"
        class="save-banner"
      >
        <template #icon><i class="pi pi-exclamation-triangle" style="font-size: 18px" aria-hidden="true"></i></template>
        {{ $t('labels.impact_has_breaking', { n: checkResult.summary.breaking }) }}
      </Message>

      <DataTable v-if="checkResult.products.length" :value="sortedProducts" data-key="productId" size="small" class="save-table">
        <Column field="name" :header="$t('labels.name')" />
        <Column field="version" :header="$t('labels.version')" :style="{ width: '80px' }" />
        <Column field="impact" :header="$t('labels.impact_label')" :style="{ textAlign: 'center' }">
          <template #body="{ data }">
            <Tag class="save-row-chip" :class="`save-row-chip--${chipColor(data.impact)}`">
              <template #icon><i :class="`pi pi-${chipIcon(data.impact)}`" style="font-size: 13px; color: var(--p-primary-contrast-color)" aria-hidden="true"></i></template>
              {{ impactLabel(data.impact) }}
            </Tag>
          </template>
        </Column>
        <Column field="reason" :header="$t('labels.description')">
          <template #body="{ data }">
            <span v-if="data.reason" class="save-reason">{{ data.reason }}</span>
            <span v-else class="save-reason--vacio">—</span>
          </template>
        </Column>
      </DataTable>

      <Message severity="secondary" :closable="false">
        <template #icon><i class="pi pi-history" aria-hidden="true"></i></template>
        {{ $t('labels.save_commit_preview', { path: modelPath }) }}
      </Message>
    </template>

    <!-- Saving -->
    <div v-else-if="phase === 'saving'" class="save-loading">
      <ProgressSpinner
        style="width: 40px; height: 40px"
        class="save-loading__spinner"
        :dt="{ colorOne: 'var(--p-accent-color)', colorTwo: 'var(--p-accent-color)', colorThree: 'var(--p-accent-color)', colorFour: 'var(--p-accent-color)' }"
      />
      <div class="save-loading__text">{{ $t('labels.save_committing') }}</div>
    </div>

    <!-- Done -->
    <Message v-else-if="phase === 'done' && saveResult" severity="success" :closable="false">
      <template #icon><i class="pi pi-check-circle" style="font-size: 18px" aria-hidden="true"></i></template>
      <div>
        {{ saveResult.changed
          ? $t('labels.save_version_bumped', { previous: saveResult.previousVersion, version: saveResult.version })
          : $t('labels.save_no_version_change', { version: saveResult.version }) }}
      </div>
      <div class="save-note">{{ $t('labels.save_committed_to', { path: modelPath }) }}</div>
    </Message>

    <!-- Error -->
    <template v-else-if="phase === 'error'">
      <Message severity="error" :closable="false">
        <template #icon><i class="pi pi-times-circle" style="font-size: 18px" aria-hidden="true"></i></template>
        {{ errorMessage }}
      </Message>
      <DiagnosticList :diagnostics="diagnostics" />
    </template>

    <template #footer>
      <PrimeButton
        v-if="phase === 'review' || phase === 'error'"
        text
        :label="$t('labels.cancel')"
        @click="dialogValue = false"
      />
      <PrimeButton
        v-if="phase === 'review'"
        name="save-confirm"
        :label="$t('labels.save_confirm_button')"
        @click="confirmSave"
      />
      <PrimeButton
        v-if="phase === 'error'"
        :label="$t('labels.retry')"
        @click="retry"
      />
      <PrimeButton
        v-if="phase === 'done'"
        :label="$t('labels.close')"
        @click="dialogValue = false"
      />
    </template>
  </PrimeDialog>
</template>

<script>
import lineService from '../../services/lineService';
import migrationService from '../../services/migrationService';
import Dialog from 'primevue/dialog';
import ProgressSpinner from 'primevue/progressspinner';
import Tag from 'primevue/tag';
import Message from 'primevue/message';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Button from 'primevue/button';
import SelectButton from 'primevue/selectbutton';
import DiagnosticList from '../modules/DiagnosticList.vue';
import { describeError } from '../modules/describeError';
import { bumpVersion } from '../../utils/bumpVersion';

const BUMPS = ['patch', 'minor', 'major'];
// what is shown first: what the change breaks, then what it fixes, then the rest
const IMPACT_ORDER = { breaking: 0, fixing: 1, unaffected_invalid: 2, unaffected_valid: 3 };

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
  name: 'SaveConfirmationDialog',

  components: { PrimeDialog: Dialog, ProgressSpinner, Tag, Message, DataTable, Column, SelectButton, DiagnosticList, PrimeButton: Button },

  props: {
    dialog:    { type: Boolean, required: true },
    lineId:    { type: String,  required: true },
    // the feature model of a line with its own file ...
    content:   { type: String,  default: null },
    // the same model as UVL: what the impact on the products is worked out from
    uvl:       { type: String,  default: null },
    // which model of the SPL this is (the feature model when it is not said)
    metamodel: { type: String,  default: null },
    // ... or the modules of a line made of them
    modules:   { type: Object,  default: null },
    // what saves `modules` (the page that proposes them knows how: `async ({ modules, bump })`)
    saveModules: { type: Function, default: null },
    modelPath: { type: String,  required: true },
  },

  emits: ['update:dialog', 'saved'],

  data() {
    return {
      phase: 'checking', // checking | review | saving | done | error
      errorStage: null,  // 'check' | 'save' — decides what "Reintentar" repeats
      errorMessage: '',
      diagnostics: [],   // every problem the modules had, when they were refused
      checkResult: null,
      previousVersion: null,
      bump: 'minor',
      saveResult: null,
    };
  },

  computed: {
    dialogValue: {
      get() { return this.dialog; },
      set(v) { this.$emit('update:dialog', v); },
    },
    bumpChoices() {
      return BUMPS.map((value) => ({ value, label: this.$t(`generation.bump_${value}`) }));
    },
    nextVersion() {
      return bumpVersion(this.previousVersion, this.bump);
    },
    sortedProducts() {
      const rank = (p) => IMPACT_ORDER[p.impact] ?? 4;
      return [...(this.checkResult?.products ?? [])].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    },
  },

  watch: {
    dialog(opened) {
      if (opened) this.runCheck();
    },
  },

  mounted() {
    if (this.dialog) this.runCheck();
  },

  methods: {
    // Reuses the quick-analysis endpoint (migrationService.impact): what the validator says about each product.
    async runCheck() {
      this.phase = 'checking';
      this.checkResult = null;
      this.errorMessage = '';
      try {
        const [line, result] = await Promise.all([
          lineService.findLineById({ id: this.lineId }),
          migrationService.impact({ lineId: this.lineId, ...(this.modules ? { modules: this.modules } : { content: this.uvl ?? this.content }) }),
        ]);
        this.previousVersion = line.version;
        this.checkResult = result;
        // what breaks products is not a small change: it starts as a major one, and can be lowered
        this.bump = result.summary.breaking > 0 ? 'major' : 'minor';
        this.phase = 'review';
      } catch (err) {
        this.errorStage = 'check';
        this.errorMessage = this.resolveErrorMessage(err);
        this.phase = 'error';
      }
    },

    // El PUT no devuelve la versión resultante; se relee la línea para poder mostrarla.
    async confirmSave() {
      this.phase = 'saving';
      this.errorMessage = '';
      this.diagnostics = [];
      try {
        if (this.modules) await this.saveModules({ modules: this.modules, bump: this.bump });
        else await lineService.saveFeatureModel({ id: this.lineId, content: this.content, bump: this.bump, ...(this.metamodel ? { metamodel: this.metamodel } : {}) });
        const line = await lineService.findLineById({ id: this.lineId });
        this.saveResult = {
          previousVersion: this.previousVersion,
          version: line.version,
          changed: this.previousVersion !== line.version,
        };
        this.phase = 'done';
        this.$emit('saved', this.saveResult);
      } catch (err) {
        this.errorStage = 'save';
        this.errorMessage = this.resolveErrorMessage(err);
        this.diagnostics = describeError(err, (key) => this.$t(key)).diagnostics;
        this.phase = 'error';
      }
    },

    retry() {
      if (this.errorStage === 'save') this.confirmSave();
      else this.runCheck();
    },

    // El 429 del limitador llega como { message }, no { error } (clave i18n) — se trata aparte.
    resolveErrorMessage(err) {
      if (err.response?.status === 429) return this.$t('error_messages.too_many_requests');
      return err.response?.data?.error
        ? this.$t(err.response.data.error)
        : this.$t('error_messages.internal_error');
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
.save-dialog {
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

.save-loading {
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

.save-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.save-bump {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;

  &__label { font-size: 0.8125rem; font-weight: 600; color: var(--text-heading); }
  &__from { color: var(--text-muted); }
  &__arrow { font-size: 11px; color: var(--text-muted); }
  &__to { font-weight: 600; color: var(--p-primary-color); }
  &__hint { margin: 0 0 16px; font-size: 0.75rem; color: var(--text-muted); }
}

.save-banner { margin-bottom: 16px; }
.save-table  { margin-bottom: 16px; }

.save-analysis-box {
  padding: 16px;
  margin-bottom: 16px;
}

.save-section-title {
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.375;
  letter-spacing: 0.00714em;
  margin-bottom: 4px;
}

.save-note {
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.667;
  letter-spacing: 0.03333em;
  margin-top: 4px;
}

.save-reason {
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.667;
  letter-spacing: 0.03333em;
  color: var(--status-bad);

  &--vacio { color: var(--p-text-faint-color); }
}

.save-chip,
.save-row-chip {
  font-variant-numeric: tabular-nums;
}

.save-chip {
  &--ok      { background: var(--status-ok)          !important; color: var(--status-on-solid) !important; }
  &--bad     { background: var(--status-bad)         !important; color: var(--status-on-solid) !important; }
  &--neutral { background: var(--status-neutral-solid) !important; color: var(--status-on-solid) !important; }
}

.save-row-chip {
  &--ok      { background: var(--status-ok)          !important; color: var(--status-on-solid) !important; }
  &--bad     { background: var(--status-bad)         !important; color: var(--status-on-solid) !important; }
  &--neutral { background: var(--status-neutral-solid) !important; color: var(--status-on-solid) !important; }
  &--muted   { background: var(--text-muted)         !important; color: var(--status-on-solid) !important; }
}
</style>
