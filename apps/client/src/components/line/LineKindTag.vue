<script setup>
import { computed } from 'vue'
import Tag from 'primevue/tag'
import { lineKindOf } from 'src/utils/lineKind'

const props = defineProps({
  line: { type: Object, default: null },
})

const kind = computed(() => lineKindOf(props.line))
</script>

<template>
  <Tag class="line-kind-tag" :severity="kind.severity" :value="$t(kind.label)" :icon="`pi ${kind.icon}`" :name="`line-kind-${kind.kind}`" />
</template>

<style scoped>
.line-kind-tag {
  flex: none;
  padding: 1px 7px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.line-kind-tag :deep(.p-tag-icon) {
  font-size: 10px;
}
</style>
