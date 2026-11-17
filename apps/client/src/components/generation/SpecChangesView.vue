<template>
  <div class="spec-diff">
    <div v-if="loading" class="spec-diff__state"><i class="pi pi-spin pi-spinner" aria-hidden="true" /></div>

    <p v-else-if="!deployed" class="spec-diff__state" name="spec-diff-no-snapshot">{{ $t('generation.diff_no_snapshot') }}</p>

    <p v-else-if="!items.length" class="spec-diff__state" name="spec-diff-none">{{ $t('generation.diff_none') }}</p>

    <div v-else class="spec-diff__layout">
      <nav class="spec-diff__nav" role="tablist" aria-orientation="vertical" :aria-label="$t('generation.diff_title')">
        <button
          v-for="item in items"
          :key="item.key"
          type="button"
          role="tab"
          class="spec-diff__tab"
          :class="{ 'spec-diff__tab--on': current?.key === item.key }"
          :aria-selected="current?.key === item.key"
          :tabindex="current?.key === item.key ? 0 : -1"
          :name="`spec-diff-tab-${item.key}`"
          @click="select(item.key)"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
        >
          <i :class="item.icon" aria-hidden="true" />
          <span class="spec-diff__tab-label">{{ item.label }}</span>
          <span class="spec-diff__tab-count">{{ item.count }}</span>
        </button>
      </nav>

      <section v-if="current" class="spec-diff__view" role="tabpanel" :name="`spec-diff-view-${current.key}`">
        <header class="spec-diff__view-head">
          <h3>{{ current.title }}</h3>
          <div v-if="!readonly" class="spec-diff__view-actions">
            <template v-if="current.discardable && confirming === current.key">
              <span class="spec-diff__confirm">{{ $t('generation.discard_confirm') }}</span>
              <PrimeButton text size="small" :label="$t('labels.cancel')" @click="confirming = null" />
              <PrimeButton
                size="small" severity="danger"
                :label="$t('generation.discard_yes')"
                :loading="busy"
                name="spec-diff-discard-confirm"
                @click="discard([current.key])"
              />
            </template>
            <PrimeButton
              v-else-if="current.discardable"
              text size="small" severity="danger"
              icon="pi pi-undo"
              :label="$t('generation.discard_this')"
              :disabled="busy"
              name="spec-diff-discard"
              @click="confirming = current.key"
            />
            <span v-else class="spec-diff__note">{{ $t('generation.diff_new_model') }}</span>
          </div>
        </header>

        <ul v-if="current.kind === 'features'" class="spec-diff__rows">
          <li v-for="c in features" :key="`${c.kind}-${c.after ?? c.before}`" :class="`spec-diff__row spec-diff__row--${c.kind}`">
            <i :class="c.kind === 'added' ? 'pi pi-plus' : 'pi pi-minus'" aria-hidden="true" />
            <span class="ident">{{ c.after ?? c.before }}</span>
          </li>
        </ul>

        <ul v-else-if="current.kind === 'fields'" class="spec-diff__rows">
          <li v-for="c in fields" :key="c.path" class="spec-diff__row spec-diff__row--changed">
            <span class="ident spec-diff__path">{{ c.path }}</span>
            <span v-if="c.list" class="spec-diff__values">{{ $t('generation.diff_items', { before: c.before, after: c.after }) }}</span>
            <span v-else class="spec-diff__values">
              <del>{{ show(c.before) }}</del>
              <i class="pi pi-arrow-right" aria-hidden="true" />
              <ins>{{ show(c.after) }}</ins>
            </span>
          </li>
        </ul>

        <pre v-else class="spec-diff__code"><template v-for="(line, i) in current.lines" :key="i"><span
          v-if="line.type === 'gap'"
          class="spec-diff__line spec-diff__line--gap"
        >… {{ $t('generation.diff_unchanged_lines', { n: line.skipped }) }}</span><span
          v-else
          class="spec-diff__line"
          :class="`spec-diff__line--${line.type}`"
        ><b aria-hidden="true">{{ line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ' }}</b>{{ line.text }}</span></template></pre>
      </section>
    </div>

    <footer v-if="!loading && deployed && items.length" class="spec-diff__footer">
      <span class="spec-diff__lead">
        <span class="ident">{{ fromLabel || `v${version}` }}</span>
        <i class="pi pi-arrow-right" aria-hidden="true" />
        <span :class="{ ident: toLabel }">{{ toLabel || $t('generation.diff_saved') }}</span>
      </span>
      <PrimeButton
        v-if="!readonly && items.length > 1"
        text size="small" severity="danger"
        icon="pi pi-undo"
        :label="$t('generation.discard_all')"
        :disabled="busy || !allDiscardable"
        name="spec-diff-discard-all"
        @click="discard([])"
      />
    </footer>
  </div>
</template>

<script>
import Button from 'primevue/button';
import { diffSpecs } from 'src/utils/specDiff';
import { diffLines, withContext } from 'src/utils/textDiff';

const SHORT = 80;

// What was generated against what is saved, one view per thing that changed: the feature selection, the other fields of the
// spec and each model. Each view can be put back to what was generated on its own. The dialogs that show it (the differences,
// the preview of a generation) put it inside.
export default {
  name: 'SpecChangesView',
  components: { PrimeButton: Button },
  props: {
    loading: { type: Boolean, default: false },
    // the spec of the last generation (null when it was not kept) and the saved one
    deployed: { type: Object, default: null },
    saved: { type: Object, default: null },
    // the models of the product (metamodel name -> text) as that generation used them and as they are now; null when unknown
    models: { type: Object, default: null },
    version: { type: String, default: '' },
    // a discard is on its way
    busy: { type: Boolean, default: false },
    // only to look at: nothing can be put back from here (the changes of an old version)
    readonly: { type: Boolean, default: false },
    // what is compared with what, when it is not "the last generation" with "what is saved"
    fromLabel: { type: String, default: '' },
    toLabel: { type: String, default: '' },
  },
  emits: ['discard'],
  data() {
    return { selected: null, confirming: null };
  },
  computed: {
    changes() {
      return this.deployed && this.saved ? diffSpecs(this.deployed, this.saved) : [];
    },
    features() {
      return this.changes.filter((c) => c.path === 'features');
    },
    fields() {
      // the version is what the two sides are called, not something that changed in them
      return this.changes.filter((c) => c.path !== 'features' && c.path !== 'basicData.version');
    },
    // the models that are not what they were, with the lines that changed
    modelChanges() {
      const before = this.models?.deployed;
      const after = this.models?.saved;
      if (!before || !after) return [];
      return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
        .filter((name) => (before[name] ?? '') !== (after[name] ?? ''))
        .map((name) => ({ name, isNew: !(name in before), lines: withContext(diffLines(before[name] ?? '', after[name] ?? '')) }));
    },
    items() {
      const items = [];
      if (this.features.length) {
        items.push({
          key: 'features', kind: 'features', icon: 'pi pi-sitemap', discardable: true,
          label: this.$t('generation.diff_features'), title: this.$t('generation.diff_features'), count: this.features.length,
        });
      }
      if (this.fields.length) {
        items.push({
          key: 'fields', kind: 'fields', icon: 'pi pi-sliders-h', discardable: true,
          label: this.$t('generation.diff_fields'), title: this.$t('generation.diff_fields'), count: this.fields.length,
        });
      }
      for (const m of this.modelChanges) {
        items.push({
          key: `model:${m.name}`, kind: 'model', icon: 'pi pi-file', discardable: !m.isNew, lines: m.lines,
          label: m.name, title: this.$t('generation.diff_model', { name: m.name }),
          count: m.lines.filter((l) => l.type === 'add' || l.type === 'del').length,
        });
      }
      return items;
    },
    current() {
      return this.items.find((i) => i.key === this.selected) ?? this.items[0] ?? null;
    },
    allDiscardable() {
      return this.items.some((i) => i.discardable);
    },
  },
  watch: {
    // another product, or the same one after something was put back
    items() {
      if (!this.items.some((i) => i.key === this.selected)) this.selected = this.items[0]?.key ?? null;
      this.confirming = null;
    },
  },
  methods: {
    select(key) {
      this.selected = key;
      this.confirming = null;
    },
    move(step) {
      const at = this.items.findIndex((i) => i.key === this.current?.key);
      const next = this.items[(at + step + this.items.length) % this.items.length];
      if (next) {
        this.select(next.key);
        this.$nextTick(() => this.$el?.ownerDocument?.querySelector?.(`[name="spec-diff-tab-${next.key}"]`)?.focus?.());
      }
    },
    discard(parts) {
      this.confirming = null;
      this.$emit('discard', parts);
    },
    show(value) {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      return text === undefined ? '—' : (text.length > SHORT ? `${text.slice(0, SHORT)}…` : text);
    },
  },
};
</script>

<style scoped lang="scss">
.spec-diff {
  &__footer {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--p-content-border-color);
  }

  &__state { margin: 0; padding: 16px 0; text-align: center; color: var(--text-muted); }

  &__layout {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    gap: 16px;
    min-height: 220px;
  }

  &__nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-right: 12px;
    border-right: 1px solid var(--p-content-border-color);
  }

  &__tab {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    text-align: left;
    cursor: pointer;
    color: var(--text-heading);
    background: transparent;
    border: 0;
    border-radius: 6px;

    &:hover { background: color-mix(in srgb, var(--p-primary-color) 7%, transparent); }
    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: -2px; }
    &--on { background: color-mix(in srgb, var(--p-primary-color) 12%, transparent); font-weight: 600; }

    i { font-size: 0.8125rem; color: var(--text-muted); }
  }

  &__tab-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8125rem; }

  &__tab-count {
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
    padding: 0 6px;
    border-radius: 999px;
    color: var(--text-muted);
    border: 1px solid var(--p-content-border-color);
  }

  &__view { min-width: 0; }

  &__view-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;

    h3 { margin: 0; font-size: 0.9375rem; font-weight: 600; }
  }

  &__view-actions { display: flex; align-items: center; gap: 4px; }
  &__confirm { font-size: 0.8125rem; margin-right: 4px; }
  &__note { font-size: 0.75rem; color: var(--text-muted); }

  &__lead {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-right: auto;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  &__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }

  &__row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 0.8125rem;

    &--added { background: color-mix(in srgb, var(--status-ok) 12%, transparent); i { color: var(--status-ok); } }
    &--removed { background: color-mix(in srgb, var(--status-bad) 12%, transparent); i { color: var(--status-bad); } }
    &--changed { background: color-mix(in srgb, var(--status-warn) 10%, transparent); }
  }

  &__path { flex: 0 0 auto; }

  &__code {
    margin: 0;
    padding: 6px 0;
    max-height: 340px;
    overflow: auto;
    font-size: 0.75rem;
    line-height: 1.5;
    border: 1px solid var(--p-content-border-color);
    border-radius: 6px;
  }

  &__line {
    display: block;
    padding: 0 10px;
    white-space: pre;

    b { display: inline-block; width: 1.4ch; margin-right: 4px; font-weight: 600; opacity: 0.7; }
    &--add { background: color-mix(in srgb, var(--status-ok) 14%, transparent); }
    &--del { background: color-mix(in srgb, var(--status-bad) 14%, transparent); }
    &--gap { color: var(--text-muted); font-style: italic; }
  }

  &__values {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    overflow-wrap: anywhere;

    del { color: var(--status-bad); }
    ins { color: var(--status-ok); text-decoration: none; }
  }
}

@media (max-width: 640px) {
  .spec-diff__layout { grid-template-columns: minmax(0, 1fr); }
  .spec-diff__nav { flex-direction: row; flex-wrap: wrap; border-right: 0; padding-right: 0; border-bottom: 1px solid var(--p-content-border-color); padding-bottom: 8px; }
  .spec-diff__tab { width: auto; }
}
</style>
