<script setup>
import { useTheme } from 'src/composables/useTheme'
import Button from 'primevue/button'
import Tooltip from 'primevue/tooltip'

// Igual que LanguageSelector: la variante `variant="item"` del original
// desaparece — DashboardLayout mete el toggle inline en su PrimeMenu usando
// `useTheme()` directamente. Este componente solo cubre la variante botón
// (footer del MainLayout).

// En <script setup>, un directive local se registra declarando `vXxx` — Vue
// resuelve `v-tooltip` a este binding en tiempo de compilación.
const vTooltip = Tooltip

const { isDark, toggleTheme } = useTheme()
</script>

<template>
  <Button
    text
    size="small"
    :style="{ color: 'var(--text-muted)' }"
    :aria-label="$t('labels.toggle_theme')"
    v-tooltip="$t('labels.toggle_theme')"
    @click="toggleTheme"
  >
    <template #icon>
      <i :class="isDark ? 'pi pi-sun' : 'pi pi-moon'" style="font-size: 18px" aria-hidden="true" />
    </template>
  </Button>
</template>
