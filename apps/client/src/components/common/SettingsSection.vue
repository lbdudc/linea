<script setup>
// A group of settings: what it is for on the left, its fields on the right. One under another, they are the page of settings of something.
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
})
</script>

<template>
  <section class="ssec">
    <header class="ssec__head">
      <h3 class="ssec__title">{{ title }}</h3>
      <p v-if="description" class="ssec__text">{{ description }}</p>
    </header>
    <div class="ssec__body"><slot /></div>
  </section>
</template>

<style scoped>
.ssec { display: grid; grid-template-columns: 15rem minmax(0, 1fr); gap: 12px 40px; padding: 20px 24px; border: 1px solid var(--tile-border); border-radius: 10px; background: var(--tile-bg); }
.ssec__head { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ssec__title { margin: 0; font-size: 0.9375rem; font-weight: 600; color: var(--text-heading); }
.ssec__text { margin: 0; font-size: 0.8125rem; line-height: 1.45; color: var(--text-muted); }
.ssec__body { display: flex; flex-direction: column; gap: 14px; min-width: 0; max-width: 44rem; }
@media (max-width: 900px) { .ssec { grid-template-columns: 1fr; } }
</style>
