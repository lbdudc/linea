<script setup>
import PageHeader from 'components/layout/PageHeader.vue'
import InstanceSettingsForm from './InstanceSettingsForm.vue'
import { useT } from 'src/composables/useT'

const t = useT()
</script>

<template>
  <div class="sign-in">
    <PageHeader compact as="h2" :title="t('instance.sign_in.title')" :subtitle="t('instance.sign_in.subtitle')" />
    <InstanceSettingsForm group="signIn" />
  </div>
</template>

<style scoped>
.sign-in { display: flex; flex-direction: column; gap: 16px; }
</style>
