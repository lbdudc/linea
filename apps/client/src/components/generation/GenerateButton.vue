<template>
  <div class="generate-button">
    <PrimeButton
      ref="btn"
      name="product-generate"
      size="small"
      :loading="loading"
      :disabled="disabled"
      :label="$t('labels.generate')"
      aria-haspopup="dialog"
      :aria-expanded="opened"
      :severity="issues.length || pending ? 'warn' : undefined"
      @click="onClick"
    >
      <template #icon><GenerateIcon /></template>
    </PrimeButton>

    <GeneratePreviewDialog
      v-if="rendered"
      v-model:visible="opened"
      :products="[{ id: productId, name: productName, version, bump: defaultBump }]"
      :known-issues="issues"
      @confirm="onConfirm"
    />
  </div>
</template>

<script>
import Button from 'primevue/button';
import GenerateIcon from './GenerateIcon.vue';
import GeneratePreviewDialog from './GeneratePreviewDialog.vue';

// The button that generates a product: it opens what the generation would do (the version, what is saved, what is wrong with it,
// which files change) and asks before doing it.
export default {
  name: 'GenerateButton',
  components: { PrimeButton: Button, GenerateIcon, GeneratePreviewDialog },
  props: {
    productId: { type: String, default: '' },
    productName: { type: String, default: '' },
    version: { type: String, default: '0.0.0' },
    loading: { type: Boolean, default: false },
    // The product could not be read: there is nothing to generate.
    disabled: { type: Boolean, default: false },
    // Unsaved changes etc.: the click is reported instead of opening the preview.
    blocked: { type: Boolean, default: false },
    // Why this generation could fail, when the page already knows.
    issues: { type: Array, default: () => [] },
    // There are saved changes that no generation has deployed: the button is the next step, and says so by its colour.
    pending: { type: Boolean, default: false },
    // The part of the version the product is set to raise by default (the dialog proposes it).
    defaultBump: { type: String, default: 'patch' },
  },
  emits: ['generate', 'blocked'],
  data() {
    return { opened: false, rendered: false };
  },
  methods: {
    onClick() {
      this.open();
    },
    // From here or from somewhere else on the page (the pending-deploy tag).
    open() {
      if (this.loading || this.disabled) return;
      if (this.blocked) {
        this.$emit('blocked');
        return;
      }
      this.rendered = true;
      this.opened = true;
    },
    onConfirm(items) {
      const first = items[0];
      if (first) this.$emit('generate', first.bump);
    },
  },
};
</script>

<style scoped lang="scss">
.generate-button {
  // the button takes part in the layout of whatever groups it
  display: contents;

  :deep(svg) { width: 16px; height: 16px; }
}
</style>
