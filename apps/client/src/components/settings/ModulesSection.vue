<script setup>
import PageHeader from 'components/layout/PageHeader.vue'
import InstanceSettingsForm from './InstanceSettingsForm.vue'
import { useT } from 'src/composables/useT'

const t = useT()
</script>

<template>
  <div class="modules-config">
    <PageHeader compact as="h2" :title="t('instance.modules.title')" :subtitle="t('instance.modules.subtitle')" />
    <InstanceSettingsForm group="modules" />
  </div>
</template>

<style scoped>
.modules-config { display: flex; flex-direction: column; gap: 16px; }
</style>
