<script setup>
import { getCurrentInstance } from 'vue'
import { relativeShort } from 'src/utils/relativeTime'

// The runs, kept beside the detail of one of them so the person can go from one to another without going back. Each one is told by the
// colour and the icon of how it stands; it folds to a strip of those icons.
defineProps({
  runs: { type: Array, required: true },
  selected: { type: String, default: null },
  collapsed: { type: Boolean, default: false },
  showProduct: { type: Boolean, default: true },
})
defineEmits(['select', 'toggle'])
const instance = getCurrentInstance()
const when = (at) => (at ? relativeShort(at, instance?.proxy?.$i18n?.locale) : '')
const ICON = { ok: 'pi pi-check', run: 'pi pi-spin pi-spinner', wait: 'pi pi-clock', bad: 'pi pi-times', stop: 'pi pi-ban' }
const iconOf = (run) => ICON[run.state] ?? 'pi pi-circle'
</script>

<template>
  <aside class="rail" :class="{ 'rail--folded': collapsed }" name="cicd-rail">
    <header class="rail__head">
      <span v-if="!collapsed" class="rail__title">{{ $t('cicdview.rail_title') }}<span class="rail__count">{{ runs.length }}</span></span>
      <button
        type="button" class="rail__fold" name="cicd-rail-toggle" :aria-expanded="!collapsed"
        :title="collapsed ? $t('cicdview.rail_show') : $t('cicdview.rail_hide')" :aria-label="collapsed ? $t('cicdview.rail_show') : $t('cicdview.rail_hide')"
        @click="$emit('toggle')"
      ><i :class="collapsed ? 'pi pi-angle-double-right' : 'pi pi-angle-double-left'" aria-hidden="true" /></button>
    </header>
    <ul class="rail__list">
      <li v-for="run in runs" :key="run.id">
        <button
          type="button" class="rail__item" :class="[`rail__item--${run.state}`, { 'rail__item--on': run.id === selected }]" :name="`rail-${run.id}`"
          :title="collapsed ? `${run.productName ?? ''} ${run.version ? 'v' + run.version : ''}`.trim() : undefined"
          :aria-label="`${run.productName ?? ''} ${run.version ? 'v' + run.version : ''}`.trim()" :aria-current="run.id === selected"
          @click="$emit('select', run)"
        >
          <span class="rail__badge"><i :class="iconOf(run)" aria-hidden="true" /></span>
          <span v-if="!collapsed" class="rail__text">
            <span class="rail__line">
              <span class="rail__name">{{ showProduct ? run.productName : $t(`cicdview.kind_${run.kind}`) }}</span>
              <span v-if="run.version" class="rail__ver">{{ run.kind === 'sync' ? '=' : '' }}v{{ run.version }}</span>
            </span>
            <span class="rail__sub">
              <span v-if="showProduct" class="rail__kind" :class="`rail__kind--${run.kind}`">{{ $t(`cicdview.kind_${run.kind}`) }}</span>
              <span class="rail__state">{{ $t(`cicdview.state_${run.state}`) }}</span>
              <span class="rail__when">{{ when(run.at) }}</span>
            </span>
          </span>
        </button>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.rail {
  width: 292px; flex: none; align-self: flex-start; position: sticky; top: 8px; max-height: calc(100vh - 96px);
  display: flex; flex-direction: column; padding: 6px; border-radius: 12px;
  background: var(--tile-bg); border: 1px solid var(--tile-border);
}
.rail--folded { width: 52px; align-items: center; }
.rail__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 4px 8px 8px; }
.rail--folded .rail__head { padding: 4px 0 8px; }
.rail__title { display: inline-flex; align-items: center; gap: 8px; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-muted); }
.rail__count { padding: 0 7px; border-radius: 99px; background: var(--p-content-hover-background); font-size: 0.6875rem; letter-spacing: 0; font-variant-numeric: tabular-nums; }
.rail__fold { width: 28px; height: 28px; display: inline-grid; place-items: center; border: 0; border-radius: 8px; background: none; color: var(--text-muted); cursor: pointer; }
.rail__fold:hover { background: var(--p-content-hover-background); color: var(--text-heading); }
.rail__fold:focus-visible, .rail__item:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 1px; }
.rail__list { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; width: 100%; }
.rail__item {
  --tone: var(--text-muted);
  width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px; border: 1px solid transparent; border-radius: 9px;
  background: none; font: inherit; text-align: left; color: inherit; cursor: pointer; transition: background 0.12s;
}
.rail--folded .rail__item { justify-content: center; padding: 6px 0; }
.rail__item--ok { --tone: var(--status-ok); } .rail__item--run { --tone: var(--p-primary-color); }
.rail__item--stop { --tone: var(--text-muted); } .rail__item--wait { --tone: var(--status-warn); } .rail__item--bad { --tone: var(--status-bad); }
.rail__item:hover { background: var(--p-content-hover-background); }
.rail__item--on { background: var(--card-bg); border-color: var(--p-primary-color); box-shadow: var(--card-shadow); }
.rail__badge {
  flex: none; width: 28px; height: 28px; display: inline-grid; place-items: center; border-radius: 50%; font-size: 0.75rem;
  color: var(--tone); background: color-mix(in srgb, var(--tone) 15%, transparent);
}
.rail__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.rail__line { display: flex; align-items: baseline; gap: 8px; }
.rail__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8125rem; font-weight: 600; color: var(--text-heading); }
.rail__ver { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.75rem; color: var(--text-muted); }
.rail__sub { display: flex; align-items: center; gap: 6px; font-size: 0.6875rem; color: var(--text-muted); white-space: nowrap; }
.rail__kind { padding: 0 6px; border-radius: 99px; background: var(--p-highlight-soft); color: var(--p-primary-color); font-weight: 500; }
.rail__kind--sync { background: var(--sync-soft); color: var(--sync); }
.rail__state { color: var(--tone); font-weight: 500; }
.rail__when { margin-left: auto; }
@media (max-width: 900px) { .rail, .rail--folded { width: 100%; position: static; max-height: 18rem; align-items: stretch; } }
</style>
