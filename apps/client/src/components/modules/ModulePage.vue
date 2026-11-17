<script setup>
import { useRouter } from 'vue-router'
import Button from 'primevue/button'

// The frame of the pages of modules and models: breadcrumb, a way back, a title (or your own head) and actions.
defineProps({
  // [{ label, to? }]: the last one is where you are
  crumbs: { type: Array, default: () => [] },
  title: { type: String, default: null },
  subtitle: { type: String, default: null },
  back: { type: String, default: null },
})

const router = useRouter()
</script>

<template>
  <div class="module-page">
    <nav v-if="crumbs.length" class="crumbs" aria-label="breadcrumb">
      <template v-for="(crumb, index) in crumbs" :key="index">
        <span v-if="index" class="crumbs__sep" aria-hidden="true">/</span>
        <router-link v-if="crumb.to && index < crumbs.length - 1" :to="crumb.to" class="crumbs__link">{{ crumb.label }}</router-link>
        <span v-else class="crumbs__current">{{ crumb.label }}</span>
      </template>
    </nav>

    <header class="head">
      <Button v-if="back" text rounded :aria-label="$t('labels.go_back')" icon="pi pi-arrow-left" @click="router.push(back)" />
      <div class="head__text">
        <slot name="head">
          <h1 v-if="title" class="head__title">{{ title }}</h1>
          <p v-if="subtitle" class="head__subtitle">{{ subtitle }}</p>
        </slot>
      </div>
      <div v-if="$slots.actions" class="head__actions"><slot name="actions" /></div>
    </header>

    <div class="module-page__body"><slot /></div>
  </div>
</template>

<style scoped>
.module-page { display: flex; flex-direction: column; gap: 14px; padding: 20px 28px 28px; min-height: 100%; box-sizing: border-box; }
.crumbs { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.crumbs__link { color: var(--p-text-muted-color); text-decoration: none; }
.crumbs__link:hover { color: var(--p-primary-color); text-decoration: underline; }
.crumbs__sep { color: var(--p-text-faint-color); }
.crumbs__current { color: var(--p-text-color); }
.head { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 8px 12px; }
.head__text { flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.head__title { margin: 0; font-family: var(--font-sans); font-weight: 300; font-size: 30px; line-height: 1.15; }
.head__subtitle { margin: 0; font-size: 14px; color: var(--p-text-muted-color); max-width: 75ch; }
.head__actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-left: auto; }
.module-page__body { display: flex; flex-direction: column; gap: 16px; }
</style>
