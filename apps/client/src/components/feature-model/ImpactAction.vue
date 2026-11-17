<script setup>
import { ref } from 'vue'
import Button from 'primevue/button'
import Tooltip from 'primevue/tooltip'
import ImpactAnalysisPanel from './ImpactAnalysisPanel.vue'

const vTooltip = Tooltip

// The quick analysis in the toolbar of the model editor: what the change of the model does to the products. It is about the feature
// model, and it works on the model as UVL (what the editor works out).
const props = defineProps({
  lineId: { type: String, required: true },
  uvl: { type: String, default: '' },
  isFeatureModel: { type: Boolean, default: false },
  // the rest of what the editor says of itself is not used here
  uvlInvalid: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  requestSave: { type: Function, default: null },
})

const open = ref(false)
</script>

<template>
  <template v-if="props.isFeatureModel">
    <Button
      outlined size="small"
      icon="pi pi-info-circle"
      class="model-actions__button"
      :label="$t('labels.quick_analysis')"
      :disabled="!props.uvl"
      v-tooltip.bottom="{ value: $t('labels.quick_analysis_tooltip'), showDelay: 500 }"
      @click="open = true"
    />
    <ImpactAnalysisPanel v-if="props.uvl" v-model:dialog="open" :lineId="props.lineId" :content="props.uvl" />
  </template>
</template>
