<script setup>
import { computed } from 'vue'
import Tag from 'primevue/tag'

// A label with the colour the host gives it (`#rrggbb`); a host that has none (the local one) gets a colour made from the name, so the same
// label looks the same everywhere. The colour tints the tag and does not replace the text colour, so it reads in both themes.
const props = defineProps({
  name: { type: String, required: true },
  color: { type: String, default: undefined },
})

const hue = (text) => [...text].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 360, 7)
const base = computed(() => (/^#[0-9a-f]{3,8}$/i.test(props.color ?? '') ? props.color : `hsl(${hue(props.name)} 62% 55%)`))
const style = computed(() => ({
  background: `color-mix(in srgb, ${base.value} 20%, transparent)`,
  color: `color-mix(in srgb, ${base.value} 70%, var(--text-heading))`,
  border: `1px solid color-mix(in srgb, ${base.value} 45%, transparent)`,
}))
</script>

<template>
  <Tag :value="name" :style="style" rounded class="label-tag" />
</template>

<style scoped>
.label-tag { font-weight: 600; }
</style>
