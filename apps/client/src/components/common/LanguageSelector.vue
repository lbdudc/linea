<script setup>
import { computed, ref } from 'vue'
import { LANGUAGES, i18n, setLocale } from 'src/boot/i18n'
import Button from 'primevue/button'
import Menu from 'primevue/menu'

// El original tenía dos variantes: `variant="item"` (dentro del user dropdown
// del DashboardLayout) y `variant="button"` (footer del MainLayout). La
// variante "item" desaparece — DashboardLayout ahora construye su propio
// PrimeMenu y mete las opciones de idioma como submenú inline via
// `LANGUAGES`+`setLocale`. Este componente solo cubre la variante "button".

defineProps({ named: { type: Boolean, default: false } })

const menuRef = ref(null)
const currentName = computed(() => LANGUAGES.find((lang) => lang.code === i18n.global.locale)?.name ?? '')

const items = LANGUAGES.map(lang => ({
  label: lang.name,
  command: () => setLocale(lang.code),
}))

const toggle = (evt) => menuRef.value?.toggle(evt)
</script>

<template>
  <Button
    text
    size="small"
    :style="{ color: 'var(--text-muted)' }"
    :aria-label="$t('labels.language')"
    @click="toggle"
  >
    <template #icon><i class="pi pi-globe" style="font-size: 18px" aria-hidden="true" /></template>
    <template v-if="named" #default><span class="language-name">{{ currentName }}</span></template>
  </Button>
  <Menu ref="menuRef" :model="items" popup />
</template>
