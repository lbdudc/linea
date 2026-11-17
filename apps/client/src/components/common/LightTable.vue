<script setup>
// A plain <table> for the lists of the app (lines, products, deployments). PrimeVue's DataTable makes a component (with its own
// pass-through merging) for every cell, which froze the page for a second or more when a list opened; this renders the same rows as
// elements. It does what those lists used: sorting, paging, a clickable row and a pending state made of skeleton rows.
//
// columns: [{ key, header, field?, align?, class?, sortable?, width? }]. A cell is the `cell-<key>` slot ({ row }), or `row[field ?? key]`.
import { computed, ref, watch } from 'vue'
import Paginator from 'primevue/paginator'

const props = defineProps({
  columns: { type: Array, required: true },
  rows: { type: Array, default: () => [] },
  rowKey: { type: String, default: '_id' },
  // rows per page; 0 shows them all
  perPage: { type: Number, default: 0 },
  sortField: { type: String, default: null },
  sortOrder: { type: Number, default: 1 },
  // true while there is nothing to show yet: skeleton rows take the place of the rows
  loading: { type: Boolean, default: false },
  // height of a row in px
  rowHeight: { type: Number, default: 40 },
  // 'design' (the lists) | 'app' (the denser table of a line's products)
  variant: { type: String, default: 'design' },
  clickable: { type: Boolean, default: true },
  rowClass: { type: Function, default: null },
  selectable: { type: Boolean, default: false },
  selection: { type: Array, default: () => [] },
})
const emit = defineEmits(['row-click', 'update:selection'])

// the sort that is on: the one asked for, then the one the person picks on a header
const sort = ref({ field: props.sortField, order: props.sortOrder })
watch(() => [props.sortField, props.sortOrder], ([field, order]) => { sort.value = { field, order } })

function toggleSort(column) {
  if (!column.sortable) return
  const field = column.field ?? column.key
  const now = sort.value
  if (now.field !== field) sort.value = { field, order: 1 }
  else if (now.order === 1) sort.value = { field, order: -1 }
  else sort.value = { field: null, order: 1 }
}

const compare = (a, b) => {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

const sorted = computed(() => {
  const { field, order } = sort.value
  if (!field) return props.rows
  const factor = order < 0 ? -1 : 1
  // a missing value goes last whichever way it is sorted
  return props.rows.slice().sort((a, b) => {
    const x = a?.[field]
    const y = b?.[field]
    if (x == null || y == null) return compare(x, y)
    return factor * compare(x, y)
  })
})

const first = ref(0)
watch(() => props.rows.length, (count) => {
  if (first.value >= count) first.value = Math.max(0, Math.floor((count - 1) / (props.perPage || 1)) * (props.perPage || 1))
})
watch(sort, () => { first.value = 0 })

const visible = computed(() => (props.perPage ? sorted.value.slice(first.value, first.value + props.perPage) : sorted.value))
const paged = computed(() => props.perPage > 0 && props.rows.length > props.perPage)

const ghostRows = computed(() => Array.from({ length: props.perPage || 6 }, (_, i) => i))
const ghostWidth = (column, row) => `${40 + ((column * 17 + row * 11) % 45)}%`

const skeleton = computed(() => props.loading && props.rows.length === 0)

const isSorted = (column) => sort.value.field === (column.field ?? column.key)
const sortIcon = (column) => {
  if (!isSorted(column)) return 'pi-sort-alt'
  return sort.value.order < 0 ? 'pi-sort-amount-down' : 'pi-sort-amount-up-alt'
}
const ariaSort = (column) => (!column.sortable ? undefined : !isSorted(column) ? 'none' : sort.value.order < 0 ? 'descending' : 'ascending')

const keyOf = (row) => String(row?.[props.rowKey])
const selectedKeys = computed(() => new Set(props.selection.map(keyOf)))
const allSelected = computed(() => props.rows.length > 0 && props.rows.every((row) => selectedKeys.value.has(keyOf(row))))
function toggleRow(row) {
  const key = keyOf(row)
  emit('update:selection', selectedKeys.value.has(key) ? props.selection.filter((r) => keyOf(r) !== key) : [...props.selection, row])
}
const toggleAll = () => emit('update:selection', allSelected.value ? [] : props.rows.slice())

// a click on a button, link or field inside the row is for that, not for the row
const INTERACTIVE = 'a, button, input, select, textarea, label, [data-no-row]'
function onRowClick(event, row) {
  if (!props.clickable || event.target.closest?.(INTERACTIVE)) return
  emit('row-click', row)
}
function onRowKey(event, row) {
  if (!props.clickable || event.target !== event.currentTarget) return
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('row-click', row)
  }
}

const cellStyle = (column) => ({ textAlign: column.align || 'left', width: column.width })
</script>

<template>
  <div class="lt" :class="`lt--${variant}`" :style="{ '--lt-row': `${rowHeight}px` }">
    <table class="lt__table">
      <thead>
        <tr>
          <th v-if="selectable" class="lt__check" scope="col">
            <input type="checkbox" :checked="allSelected" :aria-label="$t('deployments.select_all')" @change="toggleAll" />
          </th>
          <th
            v-for="column in columns"
            :key="column.key"
            scope="col"
            :class="[column.class, { 'lt__sortable': column.sortable, 'lt__sorted': isSorted(column) }]"
            :style="cellStyle(column)"
            :aria-sort="ariaSort(column)"
            :tabindex="column.sortable ? 0 : undefined"
            @click="toggleSort(column)"
            @keydown.enter="toggleSort(column)"
          >
            <slot :name="`head-${column.key}`" :column="column">{{ column.header }}</slot>
            <i v-if="column.sortable" class="pi lt__sort" :class="sortIcon(column)" aria-hidden="true" />
          </th>
        </tr>
      </thead>

      <tbody v-if="skeleton" aria-busy="true">
        <tr v-for="r in ghostRows" :key="r" class="lt__ghost">
          <td v-if="selectable" class="lt__check" />
          <td v-for="(column, c) in columns" :key="column.key" :class="column.class" :style="cellStyle(column)">
            <span class="lt__bar" :style="{ width: ghostWidth(c, r) }" />
          </td>
        </tr>
      </tbody>

      <tbody v-else>
        <tr
          v-for="row in visible"
          :key="keyOf(row)"
          :class="[{ 'lt__row--click': clickable }, rowClass ? rowClass(row) : null]"
          :tabindex="clickable ? 0 : undefined"
          @click="onRowClick($event, row)"
          @keydown="onRowKey($event, row)"
        >
          <td v-if="selectable" class="lt__check">
            <input type="checkbox" :checked="selectedKeys.has(keyOf(row))" :aria-label="$t('labels.select_row')" @change="toggleRow(row)" />
          </td>
          <td v-for="column in columns" :key="column.key" :class="column.class" :style="cellStyle(column)">
            <slot :name="`cell-${column.key}`" :row="row">{{ row[column.field ?? column.key] }}</slot>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="!skeleton && rows.length === 0" class="lt__empty"><slot name="empty" /></div>

    <Paginator
      v-if="paged"
      v-model:first="first"
      :rows="perPage"
      :total-records="rows.length"
      class="lt__pager"
    />
  </div>
</template>

<style scoped lang="scss">
.lt__table {
  width: 100%;
  border-collapse: collapse;
}

.lt th,
.lt td {
  text-align: left;
}

.lt__sortable { cursor: pointer; user-select: none; }
.lt__sort { margin-left: 6px; font-size: 10px; opacity: 0.55; }
.lt__sorted .lt__sort { opacity: 1; color: var(--p-primary-color); }

.lt__check { width: 3rem; text-align: center !important; }
.lt__check input { accent-color: var(--p-primary-color); cursor: pointer; }

.lt__row--click { cursor: pointer; }
.lt__row--click:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: -2px; }

// the lists
.lt--design {
  th {
    height: 32px;
    padding: 0 12px;
    border-bottom: 1px solid var(--p-content-border-color);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--p-text-dim-color);
  }

  td {
    height: var(--lt-row);
    padding: 0 12px;
    border-bottom: 1px solid var(--p-content-hover-background);
    font-size: 13px;
  }
}

// the denser table of a line's products
.lt--app {
  th {
    padding: 10px 14px;
    border-bottom: 1px solid var(--p-content-border-color);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--p-text-muted-color);
    background: var(--p-content-hover-background);
  }

  td {
    height: var(--lt-row);
    padding: 10px 14px;
    border-bottom: 1px solid var(--p-content-border-color);
    font-size: var(--text-base);
  }

  .lt__row--click:hover td { background: var(--p-content-hover-background); }
}

.lt--design .lt__row--click:hover td { background: var(--p-content-hover-background); }

// the pending state: rows of the same height as the real ones, so nothing moves when the data arrives
.lt__ghost td { pointer-events: none; }
.lt__bar {
  display: block;
  height: 12px;
  max-width: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg,
    var(--p-skeleton-background, var(--p-content-hover-background)) 25%,
    var(--p-skeleton-animation-background, var(--p-content-border-color)) 50%,
    var(--p-skeleton-background, var(--p-content-hover-background)) 75%);
  background-size: 200% 100%;
  animation: lt-shimmer 1.4s linear infinite;
}
.lt--design .lt__ghost td:first-child .lt__bar { height: 14px; }

@keyframes lt-shimmer {
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .lt__bar { animation: none; }
}

.lt__pager {
  background: transparent;
  border: 0;
}

// narrow screens: the columns the lists mark as secondary go away (the row still opens its page)
@media (max-width: 700px) {
  .lt :deep(.col-wide) { display: none; }
}
@media (max-width: 480px) {
  .lt :deep(.col-xs) { display: none; }
}
</style>
