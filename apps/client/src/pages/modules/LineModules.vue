<script setup>
import { ref, computed } from 'vue'
import LineShell from 'components/line/LineShell.vue'
import LinePackages from 'components/modules/LinePackages.vue'

defineProps({ id: { type: String, required: true } })
const line = ref(null)
const kind = ref(null)
const only = computed(() => (kind.value === 'project' ? 'module' : null))

const onLoaded = ({ line: loaded, info }) => {
  line.value = loaded
  kind.value = info?.kind ?? loaded?.kind ?? null
}
</script>

<template>
  <LineShell :id="id" active="modules" :line="line">
    <LinePackages :id="id" :only="only" @loaded="onLoaded" />
  </LineShell>
</template>
