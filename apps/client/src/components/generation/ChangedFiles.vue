<script setup>
import { computed, ref } from 'vue'
import { changeTree } from 'src/utils/changeTree'

defineOptions({ name: 'ChangedFiles' })
const props = defineProps({
  files: { type: Array, default: () => [] },
  nodes: { type: Array, default: null },
  open: { type: Boolean, default: false },
})

const tree = computed(() => props.nodes ?? changeTree(props.files))
const folded = ref(new Set())
const shown = ref(new Set())
const isFolderOpen = (node) => (folded.value.has(node.path) ? !props.open : props.open)
const toggleFolder = (node) => {
  const next = new Set(folded.value)
  if (next.has(node.path)) next.delete(node.path)
  else next.add(node.path)
  folded.value = next
}
const toggleDiff = (node) => {
  const next = new Set(shown.value)
  if (next.has(node.path)) next.delete(node.path)
  else next.add(node.path)
  shown.value = next
}
const MARK = { create: '+', update: '~', delete: '-' }
const lineClass = (line) => (line.startsWith('+') ? 'cf__line--add' : line.startsWith('-') ? 'cf__line--del' : line.startsWith('@@') ? 'cf__line--hunk' : '')
</script>

<template>
  <ul class="cf" name="changed-files">
    <li v-for="node in tree" :key="node.path">
      <template v-if="node.file">
        <button type="button" class="cf__row" :class="`cf__row--${node.file.action}`" :name="`cf-file-${node.path}`" :aria-expanded="shown.has(node.path)" @click="toggleDiff(node)">
          <b aria-hidden="true">{{ MARK[node.file.action] }}</b>
          <span class="cf__name ident">{{ node.name }}</span>
          <span v-if="node.file.added" class="cf__added">+{{ node.file.added }}</span>
          <span v-if="node.file.removed" class="cf__removed">−{{ node.file.removed }}</span>
        </button>
        <div v-if="shown.has(node.path)" class="cf__diff" :name="`cf-diff-${node.path}`">
          <p v-if="node.file.diff === null" class="cf__none">{{ $t('generation.gp_code_no_diff') }}</p>
          <pre v-else><span v-for="(line, i) in node.file.diff.split('\n')" :key="i" class="cf__line" :class="lineClass(line)">{{ line }}
</span></pre>
        </div>
      </template>
      <template v-else>
        <button type="button" class="cf__row cf__row--dir" :name="`cf-dir-${node.path}`" :aria-expanded="isFolderOpen(node)" @click="toggleFolder(node)">
          <i :class="isFolderOpen(node) ? 'pi pi-angle-down' : 'pi pi-angle-right'" aria-hidden="true" />
          <span class="cf__name ident">{{ node.name }}/</span>
          <span class="cf__total">{{ node.total }}</span>
        </button>
        <ChangedFiles v-if="isFolderOpen(node)" class="cf__nest" :nodes="node.children" :open="open" />
      </template>
    </li>
  </ul>
</template>

<style scoped>
.cf { list-style: none; margin: 0; padding: 0; font-size: 0.8125rem; }
.cf__nest { margin-left: 14px; padding-left: 8px; border-left: 1px solid var(--p-content-border-color); }
.cf__row { display: flex; align-items: baseline; gap: 8px; width: 100%; padding: 2px 4px; border: 0; background: none; font: inherit; color: var(--text-heading); text-align: left; cursor: pointer; border-radius: 4px; }
.cf__row:hover { background: var(--p-highlight-soft); }
.cf__row b { width: 12px; text-align: center; }
.cf__row--create b { color: var(--status-ok); } .cf__row--delete b { color: var(--status-bad); } .cf__row--update b { color: var(--status-warn); }
.cf__row--dir i { font-size: 0.75rem; color: var(--text-muted); }
.cf__name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.cf__added { color: var(--status-ok); font-variant-numeric: tabular-nums; }
.cf__removed { color: var(--status-bad); font-variant-numeric: tabular-nums; }
.cf__total { color: var(--text-muted); font-size: 0.75rem; }
.cf__diff { margin: 2px 0 6px 20px; border: 1px solid var(--p-content-border-color); border-radius: 6px; overflow: auto; max-height: 280px; background: var(--card-bg); }
.cf__diff pre { margin: 0; padding: 6px 0; font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.75rem; line-height: 1.45; }
.cf__line { display: block; padding: 0 10px; white-space: pre; }
.cf__line--add { background: color-mix(in srgb, var(--status-ok) 14%, transparent); }
.cf__line--del { background: color-mix(in srgb, var(--status-bad) 14%, transparent); }
.cf__line--hunk { color: var(--text-muted); }
.cf__none { margin: 0; padding: 8px 10px; color: var(--text-muted); }
</style>
