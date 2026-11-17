<script>
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import lineService from 'src/services/lineService'
import productService from 'src/services/productService'
import { notify } from 'src/composables/useNotify'

export default {
  name: 'RestoreLineDialog',
  components: { PrimeDialog: Dialog, PrimeButton: Button, Checkbox },
  props: {
    modelValue: { type: Boolean, default: false },
    line: { type: Object, default: null },
  },
  emits: ['update:modelValue', 'restored'],
  data() {
    return { products: [], selected: new Set(), loadingProducts: false, restoring: false }
  },
  computed: {
    open: {
      get() { return this.modelValue },
      set(value) { if (!this.restoring) this.$emit('update:modelValue', value) },
    },
    allSelected() {
      return this.products.length > 0 && this.selected.size === this.products.length
    },
    canConfirm() {
      return !this.loadingProducts && !this.restoring
    },
  },
  watch: {
    modelValue(now) {
      if (now) this.load()
    },
  },
  methods: {
    async load() {
      this.products = []
      this.selected = new Set()
      if (!this.line) return
      this.loadingProducts = true
      try {
        const pending = await productService.findInactiveProducts()
        this.products = pending.filter((product) => product.parentNamespaceId === this.line.namespaceId)
        this.selected = new Set(this.products.map((product) => product.repoId))
      } catch (error) {
        notify({ type: 'negative', message: this.$t(error.response?.data?.error || 'error_messages.internal_error') })
        this.$emit('update:modelValue', false)
      } finally {
        this.loadingProducts = false
      }
    },
    toggle(id, on) {
      const next = new Set(this.selected)
      if (on) next.add(id)
      else next.delete(id)
      this.selected = next
    },
    toggleAll(on) {
      this.selected = on ? new Set(this.products.map((product) => product.repoId)) : new Set()
    },
    cancel() {
      if (!this.restoring) this.$emit('update:modelValue', false)
    },
    async confirm() {
      if (!this.canConfirm) return
      this.restoring = true
      try {
        await lineService.restoreLine({ repoId: this.line.repoId, productRepoIds: [...this.selected] })
        this.restoring = false
        notify({ type: 'positive', message: this.$t('labels.line_restored', { name: this.line.name }) })
        this.$emit('update:modelValue', false)
        this.$emit('restored')
      } catch (error) {
        this.restoring = false
        notify({ type: 'negative', message: this.$t(error.response?.data?.error || 'error_messages.internal_error') })
      }
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
    :close-on-escape="!restoring"
    :dismissable-mask="!restoring"
    :draggable="false"
    class="delete-dialog"
    :style="{ width: '28rem', maxWidth: 'calc(100vw - 32px)' }"
    :pt="{ content: { class: 'delete-dialog__content' } }"
  >
    <div class="delete-dialog__panel" :class="{ 'delete-dialog__panel--busy': restoring }">
      <div class="delete-dialog__icon restore-line__icon" aria-hidden="true">
        <i v-if="!restoring" class="pi pi-replay" />
        <span v-else class="delete-dialog__spinner" />
      </div>

      <h2 class="delete-dialog__title">{{ $t('creation.restore_line_title') }}</h2>
      <p v-if="line" class="delete-dialog__name">{{ line.name }}</p>
      <p class="delete-dialog__text">{{ $t('creation.restore_line_text') }}</p>

      <div v-if="!restoring" class="delete-line__products" name="restore-line-products">
        <p v-if="loadingProducts" class="delete-line__empty">
          <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ $t('creation.delete_line_loading') }}
        </p>
        <p v-else-if="!products.length" class="delete-line__empty">{{ $t('creation.restore_line_none') }}</p>
        <template v-else>
          <div class="delete-line__head">
            <span class="delete-line__label">{{ $t('creation.restore_line_products') }}</span>
            <label class="delete-line__all">
              <Checkbox :model-value="allSelected" binary name="restore-line-all" @update:model-value="toggleAll" />
              <span>{{ $t('creation.delete_line_select_all') }}</span>
            </label>
          </div>
          <ul class="delete-line__list">
            <li v-for="product in products" :key="product.repoId">
              <label class="delete-line__row restore-line__row" :class="{ 'delete-line__row--kept': !selected.has(product.repoId) }">
                <Checkbox
                  :model-value="selected.has(product.repoId)"
                  binary
                  :name="`restore-line-product-${product.repoId}`"
                  @update:model-value="toggle(product.repoId, $event)"
                />
                <span class="delete-line__name">{{ product.name }}</span>
                <span v-if="product.version" class="delete-line__version">v{{ product.version }}</span>
              </label>
            </li>
          </ul>
          <p class="delete-line__summary">{{ $t('creation.restore_line_summary', { restored: selected.size, total: products.length }) }}</p>
          <p v-if="selected.size < products.length" class="delete-line__hint" name="restore-line-hint">{{ $t('creation.restore_line_hint') }}</p>
        </template>
      </div>

      <div class="delete-dialog__actions">
        <PrimeButton
          outlined
          severity="secondary"
          :label="$t('labels.cancel')"
          :disabled="restoring"
          class="delete-dialog__cancel"
          @click="cancel"
        />
        <PrimeButton
          :label="$t('labels.restore')"
          :loading="restoring"
          :disabled="!canConfirm"
          icon="pi pi-replay"
          name="restore-line-confirm"
          @click="confirm"
        />
      </div>
    </div>
  </PrimeDialog>
</template>

<style lang="scss">
.restore-line__icon {
  color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
}

.restore-line__row:hover {
  background: var(--p-content-hover-background);
}
</style>
