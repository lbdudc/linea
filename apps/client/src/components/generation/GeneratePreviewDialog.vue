<template>
  <PrimeDialog
    :visible="visible"
    modal
    dismissable-mask
    :header="products.length > 1 ? $t('generation.gp_title_many', { n: products.length }) : $t('generation.gp_title_one')"
    class="gp-dialog"
    style="width: 1000px; max-width: 96vw"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="gp" :class="{ 'gp--many': many }">
      <aside v-if="many" class="gp__list" :aria-label="$t('generation.gp_products')">
        <label class="gp__all">
          <Checkbox :model-value="allIncluded" binary name="gp-include-all" @update:model-value="toggleAll" />
          <span>{{ $t('generation.gp_include_all', { n: included.size, total: products.length }) }}</span>
        </label>

        <ul>
          <li
            v-for="product in products"
            :key="product.id"
            class="gp__row"
            :class="{ 'gp__row--on': focusId === product.id, 'gp__row--off': !included.has(product.id) }"
            :name="`gp-row-${product.id}`"
          >
            <Checkbox
              :model-value="included.has(product.id)"
              binary
              :name="`gp-include-${product.id}`"
              :aria-label="$t('generation.gp_include', { name: product.name })"
              @update:model-value="toggle(product.id, $event)"
            />
            <button type="button" class="gp__row-main" @click="focus(product.id)">
              <span class="gp__row-name">{{ product.name }}</span>
              <span class="gp__row-versions ident">
                v{{ product.version }} <i class="pi pi-arrow-right" aria-hidden="true" /> v{{ nextOf(product) }}
              </span>
              <span class="gp__tags">
                <span v-if="statusOf(product).invalid" class="gp__tag gp__tag--bad">{{ $t('generation.gp_tag_errors') }}</span>
                <span v-if="statusOf(product).pending === true" class="gp__tag gp__tag--warn">{{ $t('generation.pending') }}</span>
                <span v-else-if="statusOf(product).pending === false" class="gp__tag">{{ $t('generation.gp_tag_nochanges') }}</span>
                <span v-else-if="statusOf(product).pending === null" class="gp__tag">{{ $t('generation.gp_tag_first') }}</span>
              </span>
            </button>
          </li>
        </ul>
      </aside>

      <section v-if="current" class="gp__detail" :name="`gp-detail-${current.id}`">
        <header class="gp__detail-head">
          <h3>{{ current.name }}</h3>
          <span class="gp__versions ident">
            v{{ current.version }} <i class="pi pi-arrow-right" aria-hidden="true" /> <strong>v{{ nextOf(current) }}</strong>
          </span>
        </header>

        <div class="gp__block">
          <h4>{{ $t('generation.gp_version') }}</h4>
          <p v-if="recommendationOf(current)" class="gp__recommendation" name="gp-recommendation">
            {{ $t(`generation.rec_${recommendationOf(current).reason}`, { n: recommendationOf(current).n, bump: $t(`generation.bump_${recommendationOf(current).bump}`) }) }}
          </p>
          <ul class="gp__bumps" role="radiogroup" :aria-label="$t('generation.choose_version')">
            <li v-for="option in bumpOptions(current)" :key="option.bump">
              <button
                type="button"
                role="radio"
                class="bump"
                :class="{ 'bump--on': bumpOf(current) === option.bump }"
                :aria-checked="bumpOf(current) === option.bump"
                :name="`bump-${option.bump}`"
                @click="setBump(current.id, option.bump)"
              >
                <span class="bump__radio" aria-hidden="true" />
                <span class="bump__text">
                  <span class="bump__label">{{ option.label }} <span v-if="option.recommended" class="bump__rec" :name="`bump-recommended-${option.bump}`">{{ $t('generation.recommended') }}</span></span>
                  <span class="bump__desc">{{ option.desc }}</span>
                </span>
                <span class="bump__version ident">v{{ option.next }}</span>
              </button>
            </li>
          </ul>
        </div>

        <Message v-if="issuesOf(current).length" severity="warn" :closable="false" class="gp__issues" name="generate-issues">
          <div class="gp__issues-title">{{ $t('generation.issues_title') }}</div>
          <ul>
            <li v-for="(issue, i) in issuesOf(current)" :key="i">{{ issue }}</li>
          </ul>
        </Message>

        <div class="gp__block">
          <h4>{{ $t('generation.gp_changes') }}</h4>
          <div v-if="detail.loading" class="gp__state"><i class="pi pi-spin pi-spinner" aria-hidden="true" /></div>
          <p v-else-if="detail.error" class="gp__state" name="gp-changes-error">{{ detail.error }}</p>
          <p v-else-if="detail.data && detail.data.deployed === null && detail.data.version === null" class="gp__state" name="gp-first">
            {{ $t('generation.gp_first_generation') }}
          </p>
          <SpecChangesView
            v-else-if="detail.data"
            readonly
            :deployed="detail.data.deployed"
            :saved="detail.data.saved"
            :models="detail.data.models"
            :version="detail.data.version ?? current.version"
          />
        </div>

        <div class="gp__block">
          <h4>{{ $t('generation.gp_code') }}</h4>
          <PrimeButton
            v-if="!detail.code"
            text size="small"
            :label="$t('generation.gp_code_calc')"
            :loading="detail.codeLoading"
            name="gp-code-calc"
            @click="loadCode(current)"
          >
            <template #icon><i class="pi pi-code" style="font-size: 13px" aria-hidden="true" /></template>
          </PrimeButton>
          <p v-if="detail.codeError" class="gp__state" name="gp-code-error">{{ detail.codeError }}</p>
          <div v-if="detail.code" class="gp__code" name="gp-code">
            <p v-if="!detail.code.changed" class="gp__state">{{ $t('generation.gp_code_none') }}</p>
            <template v-else>
              <p class="gp__code-counts">
                <span class="gp__count gp__count--create">{{ $t('generation.gp_code_create', { n: detail.code.counts.create }) }}</span>
                <span class="gp__count gp__count--update">{{ $t('generation.gp_code_update', { n: detail.code.counts.update }) }}</span>
                <span class="gp__count gp__count--delete">{{ $t('generation.gp_code_delete', { n: detail.code.counts.delete }) }}</span>
              </p>
              <ChangedFiles :key="`${current.id}-${detail.code.version}`" class="gp__files" :files="detail.code.files" :open="detail.code.files.length <= 12" />
              <p v-if="detail.code.truncated" class="gp__state">{{ $t('generation.gp_code_truncated') }}</p>
            </template>
          </div>
        </div>
      </section>
    </div>

    <template #footer>
      <span v-if="many" class="gp__global">
        <span class="gp__global-label">{{ $t('generation.gp_apply_all') }}</span>
        <SelectButton
          :model-value="bump"
          :options="bumpChoices"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          name="gp-bump-all"
          @update:model-value="setAllBumps"
        />
      </span>
      <PrimeButton size="small" text :label="$t('labels.cancel')" name="gp-cancel" @click="$emit('update:visible', false)" />
      <PrimeButton size="small"
        :severity="anyIssue ? 'warn' : undefined"
        :disabled="!included.size"
        name="product-generate-confirm"
        :label="confirmLabel"
        @click="confirm"
      >
        <template #icon><i class="pi pi-play" style="font-size: 12px" aria-hidden="true" /></template>
      </PrimeButton>
    </template>
  </PrimeDialog>
</template>

<script>
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Message from 'primevue/message';
import SelectButton from 'primevue/selectbutton';
import SpecChangesView from './SpecChangesView.vue';
import ChangedFiles from './ChangedFiles.vue';
import productService from 'src/services/productService';
import { bumpVersion } from 'src/utils/bumpVersion';
import { recommendBump } from 'src/utils/recommendBump';

const BUMPS = ['patch', 'minor', 'major'];

const emptyDetail = () => ({
  loading: false, error: '', data: null, health: null,
  code: null, codeLoading: false, codeError: '',
});

// Before generating: for each product the version it would get (and the part to raise, per product or for all of them), what is
// saved that the last generation did not use, what is wrong with it, and, when asked, which files of the code would change.
// One product from its page, or the selection of a line.
export default {
  name: 'GeneratePreviewDialog',
  components: { PrimeDialog: Dialog, PrimeButton: Button, Checkbox, Message, SelectButton, SpecChangesView, ChangedFiles },
  props: {
    visible: { type: Boolean, required: true },
    // [{ id, name, version }]
    products: { type: Array, required: true },
    // what is known to be wrong with the product when the page already read it (one product)
    knownIssues: { type: Array, default: () => [] },
  },
  emits: ['update:visible', 'confirm'],
  data() {
    return {
      bump: 'patch',
      bumps: {},        // id -> part, when a product has its own
      included: new Set(),
      focusId: null,
      details: {},      // id -> { loading, error, data, code, ... }
      statuses: {},     // id -> { pending, invalid }
    };
  },
  computed: {
    many() {
      return this.products.length > 1;
    },
    current() {
      return this.products.find((p) => p.id === this.focusId) ?? this.products[0] ?? null;
    },
    detail() {
      return (this.current && this.details[this.current.id]) || emptyDetail();
    },
    allIncluded() {
      return this.products.length > 0 && this.included.size === this.products.length;
    },
    bumpChoices() {
      return BUMPS.map((value) => ({ value, label: this.$t(`generation.bump_${value}`) }));
    },
    anyIssue() {
      return this.products.some((p) => this.included.has(p.id) && this.issuesOf(p).length > 0);
    },
    confirmLabel() {
      if (this.many) {
        return this.$t(this.anyIssue ? 'generation.gp_confirm_many_anyway' : 'generation.gp_confirm_many', { n: this.included.size });
      }
      const next = this.current ? this.nextOf(this.current) : '';
      return this.$t(this.anyIssue ? 'generation.generate_anyway' : 'generation.generate_version', { version: next });
    },
  },
  watch: {
    visible(open) {
      if (open) this.start();
    },
  },
  mounted() {
    if (this.visible) this.start();
  },
  methods: {
    start() {
      this.bump = 'patch';
      this.bumps = {};
      this.included = new Set(this.products.map((p) => p.id));
      this.focusId = this.products[0]?.id ?? null;
      this.details = {};
      this.statuses = {};
      this.loadStatuses();
      if (this.focusId) this.loadDetail(this.focusId);
    },

    // the list says, for every product, whether it has saved changes and whether it has errors: two requests for all of them
    async loadStatuses() {
      const ids = this.products.map((p) => p.id);
      if (!ids.length) return;
      const [deployments, health] = await Promise.allSettled([
        productService.getProductsDeployments({ ids }),
        productService.getProductsStatus({ ids }),
      ]);
      const next = {};
      for (const id of ids) {
        next[id] = {
          pending: deployments.status === 'fulfilled' ? (deployments.value?.[id]?.pending ?? null) : undefined,
          invalid: health.status === 'fulfilled' ? health.value?.[id]?.health?.valid === false : false,
          error: health.status === 'fulfilled' ? (health.value?.[id]?.health?.error ?? '') : '',
        };
      }
      this.statuses = next;
    },

    // what one product shows is read when it is looked at, not for all of them up front
    async loadDetail(id) {
      if (this.details[id]?.data || this.details[id]?.loading) return;
      this.details = { ...this.details, [id]: { ...emptyDetail(), loading: true } };
      try {
        const [deployment, health] = await Promise.allSettled([
          productService.getDeployment({ id }),
          this.products.length === 1 && this.knownIssues.length ? Promise.resolve(null) : productService.getProductHealth({ id }),
        ]);
        if (deployment.status === 'rejected') throw deployment.reason;
        this.details = {
          ...this.details,
          [id]: { ...emptyDetail(), data: deployment.value, health: health.status === 'fulfilled' ? health.value : null },
        };
        this.applyRecommendation(id);
        const product = this.products.find((p) => p.id === id);
        const firstGeneration = deployment.value?.deployed === null && deployment.value?.version === null;
        if (product && !firstGeneration && !this.details[id]?.code) this.loadCode(product);
      } catch (error) {
        const code = error.response?.data?.error;
        this.details = {
          ...this.details,
          [id]: { ...emptyDetail(), error: code ? this.$t(code) : this.$t('error_messages.internal_error') },
        };
      }
    },

    recommendationOf(product) {
      const data = this.details[product.id]?.data;
      return data ? recommendBump(data.deployed, data.saved) : null;
    },
    applyRecommendation(id) {
      const product = this.products.find((p) => p.id === id);
      const found = product && this.recommendationOf(product);
      if (!found || found.bump === 'patch') return;
      if (this.bumps[id] !== undefined || (product.bump && product.bump !== 'patch') || this.bump !== 'patch') return;
      this.bumps = { ...this.bumps, [id]: found.bump };
    },

    async loadCode(product) {
      const id = product.id;
      this.details = { ...this.details, [id]: { ...this.details[id], codeLoading: true, codeError: '' } };
      try {
        const code = await productService.previewGeneration({ id, bump: this.bumpOf(product) });
        this.details = { ...this.details, [id]: { ...this.details[id], code, codeLoading: false } };
      } catch (error) {
        const data = error.response?.data;
        const text = data?.detail || (data?.error ? this.$t(data.error) : this.$t('error_messages.internal_error'));
        this.details = { ...this.details, [id]: { ...this.details[id], codeLoading: false, codeError: text } };
      }
    },

    focus(id) {
      this.focusId = id;
      this.loadDetail(id);
    },
    toggle(id, on) {
      const next = new Set(this.included);
      if (on) next.add(id); else next.delete(id);
      this.included = next;
    },
    toggleAll(on) {
      this.included = on ? new Set(this.products.map((p) => p.id)) : new Set();
    },

    bumpOf(product) {
      return this.bumps[product.id] ?? product.bump ?? this.bump;
    },
    setBump(id, part) {
      this.bumps = { ...this.bumps, [id]: part };
      // the files that would change depend on the version they carry
      const detail = this.details[id];
      if (detail?.code) this.details = { ...this.details, [id]: { ...detail, code: null } };
    },
    setAllBumps(part) {
      this.bump = part;
      this.bumps = {};
      this.details = Object.fromEntries(Object.entries(this.details).map(([id, d]) => [id, { ...d, code: null }]));
    },
    nextOf(product) {
      return bumpVersion(product.version, this.bumpOf(product));
    },
    bumpOptions(product) {
      const recommended = this.recommendationOf(product)?.bump;
      return BUMPS.map((part) => ({
        recommended: part === recommended,
        bump: part,
        label: this.$t(`generation.bump_${part}`),
        desc: this.$t(`generation.bump_${part}_desc`),
        next: bumpVersion(product.version, part),
      }));
    },

    statusOf(product) {
      const status = this.statuses[product.id] ?? {};
      return { pending: status.pending, invalid: Boolean(status.invalid) };
    },
    // the errors of a product: what the page already knew (one product), or what the health check of the list said
    issuesOf(product) {
      if (!this.many && this.knownIssues.length) return this.knownIssues;
      const found = this.details[product.id]?.health;
      if (found && found.valid === false) return [found.error || this.$t('labels.health_invalid_desc')];
      const status = this.statuses[product.id];
      if (status?.invalid) return [status.error || this.$t('labels.health_invalid_desc')];
      return [];
    },

    confirm() {
      const items = this.products
        .filter((p) => this.included.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, bump: this.bumpOf(p) }));
      this.$emit('confirm', items);
      this.$emit('update:visible', false);
    },
  },
};
</script>

<style scoped lang="scss">
.gp__recommendation { margin: 0 0 8px; font-size: 0.8125rem; color: var(--p-text-muted-color); }
.bump__rec {
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 99px;
  font-size: 0.6875rem;
  font-weight: 600;
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
  color: var(--p-primary-color);
}

.gp {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  min-height: 320px;

  &--many { grid-template-columns: 300px minmax(0, 1fr); }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    max-height: 560px;
    overflow-y: auto;
    padding-right: 12px;
    border-right: 1px solid var(--p-content-border-color);

    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  }

  &__all {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px 8px;
    font-size: 0.8125rem;
    color: var(--text-muted);
    border-bottom: 1px solid var(--p-content-border-color);
  }

  &__row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px;
    border-radius: 8px;
    border: 1px solid transparent;

    &--on { background: color-mix(in srgb, var(--p-primary-color) 8%, transparent); border-color: var(--p-primary-color); }
    &--off { opacity: 0.55; }
  }

  &__row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0;
    text-align: left;
    cursor: pointer;
    background: none;
    border: 0;
    color: var(--text-heading);
    font: inherit;
  }

  &__row-name { font-size: 0.875rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__row-versions { font-size: 0.75rem; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; }

  &__tags { display: flex; flex-wrap: wrap; gap: 4px; }

  &__tag {
    padding: 0 7px;
    font-size: 0.6875rem;
    border-radius: 999px;
    color: var(--text-muted);
    border: 1px solid var(--p-content-border-color);

    &--warn { color: var(--status-warn); background: var(--status-warn-soft); border-color: var(--status-warn-border); }
    &--bad { color: var(--status-bad); background: var(--status-bad-soft); border-color: var(--status-bad-border); }
  }

  &__detail { min-width: 0; display: flex; flex-direction: column; gap: 14px; }

  &__detail-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;

    h3 { margin: 0; font-size: 1.0625rem; font-weight: 600; }
  }

  &__versions { font-size: 0.8125rem; color: var(--text-muted); display: inline-flex; align-items: center; gap: 6px; }
  &__versions strong { color: var(--p-primary-color); }

  &__block {
    h4 {
      margin: 0 0 6px;
      font-size: 0.6875rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
  }

  // the three options are one row of equal cells: the same width, and the same height whatever their description takes
  &__bumps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-auto-rows: 1fr;
    gap: 8px;

    > li { display: flex; min-width: 0; }
  }

  &__issues { margin: 0; }
  &__issues-title { font-weight: 600; margin-bottom: 4px; }
  &__issues ul { margin: 0; padding-left: 18px; font-size: 0.8125rem; }

  &__state { margin: 0; padding: 8px 0; font-size: 0.8125rem; color: var(--text-muted); }

  &__code-counts { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 6px; font-size: 0.8125rem; }
  &__count { padding: 1px 8px; border-radius: 999px; border: 1px solid var(--p-content-border-color); font-variant-numeric: tabular-nums; }
  &__count--create { color: var(--status-ok); }
  &__count--update { color: var(--status-warn); }
  &__count--delete { color: var(--status-bad); }

  &__files {
    list-style: none;
    margin: 0;
    padding: 4px;
    max-height: 340px;
    overflow: auto;
    font-size: 0.75rem;
    border: 1px solid var(--p-content-border-color);
    border-radius: 6px;
  }

  &__global { display: inline-flex; align-items: center; gap: 8px; margin-right: auto; }
  &__global-label { font-size: 0.8125rem; color: var(--text-muted); }
}

.bump {
  width: 100%;
  min-height: 60px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  box-sizing: border-box;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: var(--text-heading);
  background: transparent;
  border: 1px solid var(--p-content-border-color);
  border-radius: var(--p-content-border-radius, 8px);
  transition: border-color 0.12s, background 0.12s;

  &:hover { border-color: var(--p-primary-color); }
  &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 1px; }

  &--on {
    border-color: var(--p-primary-color);
    background: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
  }

  &__radio {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--text-muted);
    box-sizing: border-box;
  }

  &--on &__radio {
    border-color: var(--p-primary-color);
    background: radial-gradient(circle, var(--p-primary-color) 45%, transparent 50%);
  }

  &__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  &__label { font-size: 0.875rem; font-weight: 500; line-height: 1.25; }
  // two lines at most: a longer text never makes its option taller than the others
  &__desc {
    font-size: 0.75rem;
    line-height: 1.3;
    color: var(--text-muted);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  &__version { flex-shrink: 0; font-variant-numeric: tabular-nums; font-size: 0.8125rem; color: var(--text-muted); }
}

@media (max-width: 760px) {
  .gp--many { grid-template-columns: minmax(0, 1fr); }
  .gp__list { border-right: 0; padding-right: 0; border-bottom: 1px solid var(--p-content-border-color); padding-bottom: 8px; max-height: 220px; }
  .gp__bumps { grid-template-columns: minmax(0, 1fr); }
}
</style>
