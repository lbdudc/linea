<script setup>
import { computed } from 'vue'
import { slotItems } from 'src/plugins/registry'

const props = defineProps({
  name: { type: String, required: true },
  context: { type: Object, default: () => ({}) },
})

const items = computed(() => slotItems(props.name, props.context))
</script>

<template>
  <component :is="item.component" v-for="item in items" :key="item.id" v-bind="context" />
</template>
