<script setup>
import { ref } from 'vue'
import LineShell from 'components/line/LineShell.vue'
import LinePackages from 'components/modules/LinePackages.vue'

defineProps({ id: { type: String, required: true } })
const line = ref(null)
</script>

<template>
  <LineShell :id="id" active="metamodels" :line="line">
    <LinePackages :id="id" only="metamodel" @loaded="line = $event.line" />
  </LineShell>
</template>
