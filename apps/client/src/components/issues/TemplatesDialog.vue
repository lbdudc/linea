<script setup>
import Dialog from 'primevue/dialog'
import TemplatesEditor from './TemplatesEditor.vue'

const visible = defineModel('visible', { type: Boolean, default: false })
defineProps({
  kind: { type: String, required: true },
  id: { type: String, required: true },
  subject: { type: String, required: true },
})
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t(subject === 'issue' ? 'templates.title_issues' : 'templates.title_mrs')" :style="{ width: '40rem', maxWidth: '95vw' }" name="templates-dialog">
    <TemplatesEditor :kind="kind" :id="id" :subject="subject" />
  </Dialog>
</template>
