<script setup>
import Button from 'primevue/button'
import { ref, computed, watch } from 'vue'
import { useT } from 'src/composables/useT'

const props = defineProps({
  files: { type: Array, required: true },
  active: { type: String, default: null },
  // a file that cannot be removed (the manifest)
  pinned: { type: String, default: null },
  // the files that configure the package, shown apart and first: [{ path, label, icon }]
  featured: { type: Array, default: () => [] },
})
const emit = defineEmits(['select', 'remove'])

const t = useT()

const query = ref('')
const open = ref(new Set())
const list = ref(null)

const ancestors = (file) => {
  const parts = file.split('/')
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}

// the folders on the way to the file in use are open, the rest closed: a package can have hundreds of files
watch(
  () => [props.active, props.files],
  () => {
    if (props.active) open.value = new Set([...open.value, ...ancestors(props.active)])
  },
  { immediate: true },
)

const needle = computed(() => query.value.trim().toLowerCase())
const matching = computed(() => (needle.value ? props.files.filter((f) => f.toLowerCase().includes(needle.value)) : props.files))

const ICONS = [
  [/\.(json|ya?ml|toml|properties|env|conf|ini)$/i, 'pi-cog'],
  [/\.(js|mjs|cjs|ts|vue|java|py|sh|css|scss|html|xml|sql|groovy|kt)$/i, 'pi-code'],
  [/\.(md|txt|rst|adoc)$/i, 'pi-book'],
  [/\.(png|jpe?g|gif|svg|ico|webp)$/i, 'pi-image'],
  [/\.(uvl|lm|langium)$/i, 'pi-sitemap'],
  [/^(\.gitignore|\.editorconfig|\.dockerignore|dockerfile)$/i, 'pi-cog'],
]
const iconOf = (name) => (ICONS.find(([re]) => re.test(name)) ?? [null, 'pi-file'])[1]

// the name cut in three, so the part that matched the search can be marked
const parts = (label) => {
  const at = needle.value ? label.toLowerCase().indexOf(needle.value) : -1
  if (at < 0) return null
  return [label.slice(0, at), label.slice(at, at + needle.value.length), label.slice(at + needle.value.length)]
}

const shownFeatured = computed(() => props.featured.filter((f) => props.files.includes(f.path) && (!needle.value || f.path.toLowerCase().includes(needle.value) || f.label.toLowerCase().includes(needle.value))))
const featuredPaths = computed(() => new Set(props.featured.map((f) => f.path)))

const tree = computed(() => {
  const root = { folders: new Map(), files: [] }
  for (const file of [...matching.value].filter((f) => !featuredPaths.value.has(f)).sort((a, b) => a.localeCompare(b))) {
    const segments = file.split('/')
    let node = root
    segments.slice(0, -1).forEach((name, i) => {
      const path = segments.slice(0, i + 1).join('/')
      if (!node.folders.has(name)) node.folders.set(name, { name, path, folders: new Map(), files: [], count: 0 })
      node = node.folders.get(name)
      node.count += 1
    })
    node.files.push({ name: segments[segments.length - 1], path: file })
  }
  return root
})

// folders first, then files; searching opens every folder that has a match
const rows = computed(() => {
  const out = []
  const walk = (node, depth) => {
    for (const folder of node.folders.values()) {
      // a folder holding only one folder shows as one row, a/b/c, instead of three
      let shown = folder
      let label = folder.name
      while (shown.files.length === 0 && shown.folders.size === 1) {
        shown = [...shown.folders.values()][0]
        label += `/${shown.name}`
      }
      const isOpen = needle.value !== '' || open.value.has(shown.path)
      out.push({ kind: 'folder', key: `d:${shown.path}`, path: shown.path, label, depth, count: folder.count, isOpen, parts: parts(label) })
      if (isOpen) walk(shown, depth + 1)
    }
    for (const file of node.files) {
      out.push({ kind: 'file', key: `f:${file.path}`, path: file.path, label: file.name, depth, icon: iconOf(file.name), parts: parts(file.name) })
    }
  }
  walk(tree.value, 0)
  return out
})

const folderPaths = computed(() => {
  const all = new Set()
  for (const file of props.files) ancestors(file).forEach((p) => all.add(p))
  return all
})
const hasFolders = computed(() => folderPaths.value.size > 0)
const allOpen = computed(() => hasFolders.value && [...folderPaths.value].every((p) => open.value.has(p)))

const toggle = (path) => {
  const next = new Set(open.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  open.value = next
}
const setFolder = (path, value) => {
  if (open.value.has(path) !== value) toggle(path)
}
const toggleAll = () => {
  query.value = ''
  open.value = allOpen.value ? new Set(props.active ? ancestors(props.active) : []) : new Set(folderPaths.value)
}

// arrows move through the rows, left and right close and open folders, as in any file tree
const onKeydown = (event) => {
  const items = [...(list.value?.querySelectorAll('.row__main') ?? [])]
  const at = items.indexOf(document.activeElement)
  if (at < 0) return
  const row = rows.value[at]
  const go = (to) => {
    event.preventDefault()
    items[Math.max(0, Math.min(items.length - 1, to))]?.focus()
  }
  if (event.key === 'ArrowDown') go(at + 1)
  else if (event.key === 'ArrowUp') go(at - 1)
  else if (event.key === 'Home') go(0)
  else if (event.key === 'End') go(items.length - 1)
  else if (event.key === 'ArrowRight' && row.kind === 'folder') {
    event.preventDefault()
    if (!row.isOpen) setFolder(row.path, true)
    else go(at + 1)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    if (row.kind === 'folder' && row.isOpen && !needle.value) setFolder(row.path, false)
    else {
      const up = rows.value.slice(0, at).reverse().find((r) => r.kind === 'folder' && r.depth < row.depth)
      if (up) go(rows.value.indexOf(up))
    }
  }
}
</script>

<template>
  <div class="tree">
    <div class="tree__search">
      <i class="pi pi-search" aria-hidden="true" />
      <input
        v-model="query"
        type="search"
        class="tree__input"
        :placeholder="t('modules.search_files')"
        :aria-label="t('modules.search_files')"
        @keydown.esc="query = ''"
        @keydown.down.prevent="list?.querySelector('.row__main')?.focus()"
      >
    </div>
    <section v-if="shownFeatured.length" class="key" :aria-label="t('modules.key_files')">
      <h3 class="key__title">{{ t('modules.key_files') }}</h3>
      <div v-for="item in shownFeatured" :key="item.path" class="key__row">
        <button
          type="button"
          class="key__item"
          :class="{ 'key__item--active': item.path === active }"
          :aria-current="item.path === active ? 'true' : undefined"
          @click="emit('select', item.path)"
        >
          <i class="key__icon pi" :class="item.icon" aria-hidden="true" />
          <span class="key__text">
            <span class="key__label">{{ item.label }}</span>
            <span class="key__path ident">{{ item.path }}</span>
          </span>
        </button>
        <Button
          v-if="item.path !== pinned"
          text
          rounded
          size="small"
          severity="secondary"
          icon="pi pi-trash"
          class="key__remove"
          :aria-label="t('labels.delete')"
          :title="t('labels.delete')"
          @click="emit('remove', item.path)"
        />
      </div>
    </section>
    <div class="tree__bar">
      <span class="tree__count">{{ needle ? `${matching.length} / ${files.length}` : files.length }} {{ t('modules.files').toLowerCase() }}</span>
      <button v-if="hasFolders && !needle" type="button" class="tree__toggle" @click="toggleAll">
        <i class="pi" :class="allOpen ? 'pi-angle-double-up' : 'pi-angle-double-down'" aria-hidden="true" />
        {{ allOpen ? t('modules.collapse_all') : t('modules.expand_all') }}
      </button>
    </div>
    <ul ref="list" class="tree__list" role="tree" @keydown="onKeydown">
      <li v-for="row in rows" :key="row.key" role="none">
        <div
          class="row"
          :class="{ 'row--folder': row.kind === 'folder', 'row--active': row.kind === 'file' && row.path === active }"
          :style="{ '--depth': row.depth }"
        >
          <button
            type="button"
            class="row__main"
            role="treeitem"
            :aria-expanded="row.kind === 'folder' ? row.isOpen : undefined"
            :aria-selected="row.kind === 'file' ? row.path === active : undefined"
            :title="row.path"
            @click="row.kind === 'folder' ? toggle(row.path) : emit('select', row.path)"
          >
            <i v-if="row.kind === 'folder'" class="row__chevron pi" :class="row.isOpen ? 'pi-chevron-down' : 'pi-chevron-right'" aria-hidden="true" />
            <i class="row__icon pi" :class="row.kind === 'folder' ? (row.isOpen ? 'pi-folder-open' : 'pi-folder') : row.icon" aria-hidden="true" />
            <span class="row__label ident">
              <template v-if="row.parts">{{ row.parts[0] }}<mark>{{ row.parts[1] }}</mark>{{ row.parts[2] }}</template>
              <template v-else>{{ row.label }}</template>
            </span>
            <span v-if="row.kind === 'folder'" class="row__count">{{ row.count }}</span>
          </button>
          <button
            v-if="row.kind === 'file' && row.path !== pinned"
            type="button"
            class="row__remove"
            :aria-label="t('labels.delete')"
            :title="t('labels.delete')"
            @click="emit('remove', row.path)"
          >
            <i class="pi pi-trash" aria-hidden="true" />
          </button>
        </div>
      </li>
      <li v-if="!rows.length && !shownFeatured.length" class="tree__empty">
        <i class="pi pi-search" aria-hidden="true" />
        {{ t('modules.no_files_match') }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.tree { display: flex; flex-direction: column; min-height: 0; }
.tree__search { display: flex; align-items: center; gap: 8px; border: 1px solid var(--p-content-border-color); border-radius: 8px; padding: 0 10px; background: var(--p-content-background); }
.tree__search:focus-within { outline: 2px solid var(--p-primary-color); outline-offset: -1px; }
.tree__search .pi { font-size: 13px; color: var(--p-text-muted-color); }
.tree__input { flex: 1; min-width: 0; border: 0; background: none; padding: 9px 0; font: inherit; font-size: 13px; color: var(--p-text-color); outline: none; }
.tree__bar { display: flex; align-items: center; justify-content: space-between; margin: 8px 2px 6px; font-size: 12px; color: var(--p-text-muted-color); }
.tree__toggle { display: inline-flex; align-items: center; gap: 4px; background: none; border: 0; padding: 2px 4px; border-radius: 4px; font: inherit; color: var(--p-text-muted-color); cursor: pointer; }
.tree__toggle:hover { color: var(--p-text-color); background: var(--p-content-hover-background); }
.tree__toggle .pi { font-size: 11px; }
.tree__list { list-style: none; margin: 0; padding: 0 2px 0 0; overflow: auto; max-height: min(68vh, 640px); display: flex; flex-direction: column; gap: 1px; scrollbar-width: thin; }
.tree__empty { display: flex; align-items: center; gap: 8px; padding: 14px 6px; font-size: 13px; color: var(--p-text-muted-color); }
.row {
  --indent: 16px;
  display: flex; align-items: center; border-radius: 6px; min-height: 28px;
  padding-left: calc(var(--depth) * var(--indent));
  /* a thin line per level, so it is clear which folder a file belongs to */
  background-image: repeating-linear-gradient(to right, var(--p-content-border-color) 0 1px, transparent 1px var(--indent));
  background-size: calc(var(--depth) * var(--indent)) 100%;
  background-repeat: no-repeat;
  background-position: 9px 0;
}
.row:hover { background-color: var(--p-content-hover-background); }
.row--active { background-color: var(--p-highlight-background, var(--p-content-hover-background)); box-shadow: inset 3px 0 0 var(--p-primary-color); }
.row--active .row__label { font-weight: 600; color: var(--p-primary-color); }
.row__main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; text-align: left; background: none; border: 0; padding: 4px 6px; border-radius: 6px; cursor: pointer; font-size: 12.5px; color: var(--p-text-color); }
.row__main:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: -2px; }
.row__chevron { font-size: 9px; width: 10px; color: var(--p-text-muted-color); }
.row:not(.row--folder) .row__icon { margin-left: 17px; }
.row__icon { font-size: 14px; color: var(--p-text-muted-color); }
.row--folder .row__icon { color: var(--p-primary-color); }
.row__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row--folder .row__label { font-weight: 600; }
.row__label mark { background: color-mix(in srgb, var(--p-primary-color) 28%, transparent); color: inherit; border-radius: 2px; padding: 0 1px; }
.row__count { font-size: 11px; line-height: 1; padding: 2px 6px; border-radius: 999px; background: var(--p-content-hover-background); color: var(--p-text-muted-color); }
.row__remove { background: none; border: 0; padding: 6px 8px; cursor: pointer; color: var(--p-text-faint-color); opacity: 0; border-radius: 6px; }
.row:hover .row__remove, .row__remove:focus-visible { opacity: 1; }
.row__remove:hover { color: var(--status-bad); }
.key { display: flex; flex-direction: column; gap: 4px; margin: 10px 0 4px; padding: 8px; border: 1px solid var(--p-content-border-color); border-radius: 8px; background: color-mix(in srgb, var(--p-primary-color) 5%, transparent); }
.key__title { margin: 0 0 2px 2px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--p-text-muted-color); }
.key__row { position: relative; }
.key__remove { position: absolute; top: 50%; right: 6px; transform: translateY(-50%); opacity: 0; transition: opacity .12s; }
.key__row:hover .key__remove, .key__row:focus-within .key__remove { opacity: 1; }
@media (hover: none) { .key__remove { opacity: 1; } }
.key__item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: none; border: 1px solid transparent; border-radius: 6px; padding: 6px 8px; cursor: pointer; color: var(--p-text-color); font: inherit; }
.key__item:hover { background: var(--p-content-hover-background); }
.key__item:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: -2px; }
.key__item--active { background: var(--p-content-background); border-color: var(--p-primary-color); }
.key__icon { font-size: 15px; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 6px; background: color-mix(in srgb, var(--p-primary-color) 14%, transparent); color: var(--p-primary-color); flex: none; }
.key__text { display: flex; flex-direction: column; min-width: 0; }
.key__label { font-size: 13px; font-weight: 600; }
.key__path { font-size: 11px; color: var(--p-text-muted-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
