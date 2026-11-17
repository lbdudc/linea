<script setup>
// The place of a panel whose code is still on its way: lines of different lengths, like the text that will be there.
import Skeleton from 'primevue/skeleton'

defineProps({ lines: { type: Number, default: 14 } })
const WIDTHS = [70, 45, 55, 35, 60, 40]
</script>

<template>
  <div class="panel-ghost" aria-busy="true">
    <Skeleton v-for="line in lines" :key="line" height="12px" :width="`${WIDTHS[line % WIDTHS.length]}%`" />
  </div>
</template>

<style scoped>
.panel-ghost {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}
</style>
