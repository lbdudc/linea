<script>
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'

// Asks before deleting an SPL or a product, and stays open (with a spinner) while the delete runs: the parent sets `loading`
// while it works and the dialog closes by itself when it ends.
export default {
  name: 'DeleteConfirmDialog',
  components: { PrimeDialog: Dialog, PrimeButton: Button, InputText },
  props: {
    modelValue: { type: Boolean, default: false },
    loading:    { type: Boolean, default: false },
    // what is going to be deleted: shown under the question
    name:       { type: String, default: '' },
    // 'line' | 'product' (words the question)
    kind:       { type: String, default: '' },
    // the name has to be typed to confirm (an SPL takes its products with it)
    requireName: { type: Boolean, default: false },
    pending: { type: Boolean, default: false },
  },
  data() {
    return { typed: '' }
  },
  emits: ['update:modelValue', 'confirm', 'cancel'],
  computed: {
    mustType() {
      return this.requireName && this.name !== ''
    },
    canConfirm() {
      return !this.mustType || this.typed.trim() === this.name
    },
    open: {
      get() { return this.modelValue },
      set(v) { if (!this.loading) this.$emit('update:modelValue', v) },
    },
    title() {
      if (this.loading) return this.$t('creation.deleting_title')
      const word = this.kind === 'product' ? this.$t('labels.product') : this.kind === 'line' ? this.$t('labels.line') : ''
      if (!word) return this.$t('labels.confirm_delete_title')
      // an acronym (LPS, SPL) stays as it is; a noun goes in lower case
      return this.$t('creation.delete_title', { kind: word === word.toUpperCase() ? word : word.toLowerCase() })
    },
    text() {
      if (this.loading) return this.$t('creation.deleting_text')
      return this.pending ? this.$t('creation.delete_pending_text') : this.$t('creation.delete_text')
    },
  },
  watch: {
    // the delete ended (done or failed): the parent shows what happened
    loading(now, before) {
      if (before && !now) this.$emit('update:modelValue', false)
    },
    // a new question starts with an empty box
    modelValue(now) {
      if (now) this.typed = ''
    },
  },
  methods: {
    cancel() {
      if (this.loading) return
      this.$emit('update:modelValue', false)
      this.$emit('cancel')
    },
    confirm() {
      if (!this.canConfirm || this.loading) return
      this.$emit('confirm')
      // a parent that does not report progress keeps the old behaviour: it closes at once
      this.$nextTick(() => {
        if (!this.loading) this.$emit('update:modelValue', false)
      })
    },
  },
}
</script>

<template>
  <PrimeDialog
    v-model:visible="open"
    modal
    :show-header="false"
    :closable="false"
    :close-on-escape="!loading"
    :dismissable-mask="!loading"
    :draggable="false"
    class="delete-dialog"
    :style="{ width: '25rem', maxWidth: 'calc(100vw - 32px)' }"
    :pt="{ content: { class: 'delete-dialog__content' } }"
  >
    <div class="delete-dialog__panel" :class="{ 'delete-dialog__panel--busy': loading }">
      <div class="delete-dialog__icon" aria-hidden="true">
        <i v-if="!loading" class="pi pi-trash" />
        <span v-else class="delete-dialog__spinner" />
      </div>

      <h2 class="delete-dialog__title">{{ title }}</h2>
      <p v-if="name" class="delete-dialog__name">{{ name }}</p>
      <p class="delete-dialog__text">{{ text }}</p>

      <div v-if="mustType && !loading" class="delete-dialog__type">
        <label class="delete-dialog__type-label" for="delete-dialog-name">
          {{ $t('creation.type_to_confirm', { name }) }}
        </label>
        <InputText
          id="delete-dialog-name"
          v-model="typed"
          class="delete-dialog__type-input"
          autocomplete="off"
          spellcheck="false"
          autofocus
          @keydown.enter.prevent="confirm"
        />
      </div>

      <div class="delete-dialog__actions">
        <PrimeButton
          outlined
          severity="secondary"
          :label="$t('labels.no')"
          :disabled="loading"
          class="delete-dialog__cancel"
          @click="cancel"
        />
        <PrimeButton
          :label="$t('labels.yes')"
          :loading="loading"
          :disabled="!canConfirm"
          icon="pi pi-trash"
          class="delete-dialog__confirm"
          @click="confirm"
        />
      </div>
    </div>
  </PrimeDialog>
</template>

<style lang="scss">
// not scoped: the dialog is teleported to the body and its content wrapper belongs to PrimeVue
.delete-dialog.p-dialog {
  border-radius: 16px;
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.delete-dialog .delete-dialog__content {
  padding: 28px 26px 24px;
}

.delete-dialog__panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.delete-dialog__icon {
  width: 56px;
  height: 56px;
  margin-bottom: 14px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 22px;
  color: var(--status-bad);
  background: var(--status-bad-soft);
  border: 1px solid var(--status-bad-border);
}

.delete-dialog__spinner {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 3px solid var(--status-bad-border);
  border-top-color: var(--status-bad);
  animation: delete-dialog-spin 0.9s linear infinite;
}

.delete-dialog__title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-heading);
}

.delete-dialog__name {
  margin: 8px 0 0;
  max-width: 100%;
  padding: 3px 10px;
  border-radius: 999px;
  font-family: var(--font-mono, monospace);
  font-size: 0.82rem;
  color: var(--text-heading);
  background: var(--status-bad-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delete-dialog__text {
  margin: 12px 0 0;
  font-size: 0.88rem;
  line-height: 1.45;
  color: var(--text-muted);
}

.delete-dialog__type {
  width: 100%;
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
}

.delete-dialog__type-label {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.delete-dialog__type-input.p-inputtext {
  width: 100%;
  font-family: var(--font-mono, monospace);
}

.delete-dialog__actions {
  width: 100%;
  margin-top: 22px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.delete-dialog__confirm.p-button {
  background: var(--status-bad-solid);
  border-color: var(--status-bad-solid);
  color: #fff;

  &:not(:disabled):hover {
    filter: brightness(0.92);
    background: var(--status-bad-solid);
    border-color: var(--status-bad-solid);
  }
}

@keyframes delete-dialog-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .delete-dialog__spinner { animation: none; }
}
</style>
