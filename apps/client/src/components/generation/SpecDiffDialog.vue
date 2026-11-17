<template>
  <PrimeDialog
    :visible="visible"
    modal
    dismissable-mask
    :header="title || $t('generation.diff_title')"
    class="spec-diff-dialog"
    style="width: 860px; max-width: 96vw"
    @update:visible="$emit('update:visible', $event)"
  >
    <SpecChangesView
      :loading="loading"
      :deployed="deployed"
      :saved="saved"
      :models="models"
      :version="version"
      :busy="busy"
      :readonly="readonly"
      :from-label="fromLabel"
      :to-label="toLabel"
      @discard="$emit('discard', $event)"
    />
  </PrimeDialog>
</template>

<script>
import Dialog from 'primevue/dialog';
import SpecChangesView from './SpecChangesView.vue';

// The differences between what was generated and what is saved (or between two versions), in a dialog.
export default {
  name: 'SpecDiffDialog',
  components: { PrimeDialog: Dialog, SpecChangesView },
  props: {
    visible: { type: Boolean, required: true },
    loading: { type: Boolean, default: false },
    // the spec of the last generation (null when it was not kept) and the saved one
    deployed: { type: Object, default: null },
    saved: { type: Object, default: null },
    // the models of the product (metamodel name -> text) as that generation used them and as they are now; null when unknown
    models: { type: Object, default: null },
    version: { type: String, default: '' },
    busy: { type: Boolean, default: false },
    readonly: { type: Boolean, default: false },
    title: { type: String, default: '' },
    fromLabel: { type: String, default: '' },
    toLabel: { type: String, default: '' },
  },
  emits: ['update:visible', 'discard'],
};
</script>
