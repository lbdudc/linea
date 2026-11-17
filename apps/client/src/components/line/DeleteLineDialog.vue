<script>
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Checkbox from 'primevue/checkbox'
import lineService from 'src/services/lineService'
import { notify } from 'src/composables/useNotify'

export default {
  name: 'DeleteLineDialog',
  components: { PrimeDialog: Dialog, PrimeButton: Button, InputText, Checkbox },
  props: {
    modelValue: { type: Boolean, default: false },
    line: { type: Object, default: null },
  },
  emits: ['update:modelValue', 'deleted'],
  data() {
    return { typed: '', products: [], selected: new Set(), loadingProducts: false, deleting: false, delayed: false }
  },
  computed: {
    open: {
      get() { return this.modelValue },
      set(value) { if (!this.deleting) this.$emit('update:modelValue', value) },
    },
    name() {
      return this.line?.name ?? ''
    },
    allSelected() {
      return this.products.length > 0 && this.selected.size === this.products.length
    },
    keepProductIds() {
      return this.products.map((product) => product._id).filter((id) => !this.selected.has(id))
    },
    canConfirm() {
      return !this.loadingProducts && !this.deleting && this.typed.trim() === this.name
    },
  },
  watch: {
    modelValue(now) {
      if (now) this.load()
    },
  },
  methods: {
    async load() {
      this.typed = ''
      this.products = []
      this.selected = new Set()
      this.delayed = false
      if (!this.line?._id) return
      this.loadingProducts = true
      try {
        const line = await lineService.findLineById({ id: this.line._id })
        this.products = line.products ?? []
        this.delayed = Boolean(line.delayedDeletion)
        this.selected = new Set(this.products.map((product) => product._id))
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
      this.selected = on ? new Set(this.products.map((product) => product._id)) : new Set()
    },
    cancel() {
      if (!this.deleting) this.$emit('update:modelValue', false)
    },
    async confirm() {
      if (!this.canConfirm) return
      this.deleting = true
      try {
        await lineService.deleteLine({ id: this.line._id, keepProductIds: this.keepProductIds })
        this.deleting = false
        this.$emit('update:modelValue', false)
        this.$emit('deleted', { id: this.line._id, keptProductIds: this.keepProductIds })
      } catch (error) {
        this.deleting = false
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
    :close-on-escape="!deleting"
    :dismissable-mask="!deleting"
    :draggable="false"
    class="delete-dialog"
    :style="{ width: '28rem', maxWidth: 'calc(100vw - 32px)' }"
    :pt="{ content: { class: 'delete-dialog__content' } }"
  >
    <div class="delete-dialog__panel" :class="{ 'delete-dialog__panel--busy': deleting }">
      <div class="delete-dialog__icon" aria-hidden="true">
        <i v-if="!deleting" class="pi pi-trash" />
        <span v-else class="delete-dialog__spinner" />
      </div>

      <h2 class="delete-dialog__title">
        {{ deleting ? $t('creation.deleting_title') : $t('creation.delete_title', { kind: $t('labels.line').toLowerCase() }) }}
      </h2>
      <p v-if="name" class="delete-dialog__name">{{ name }}</p>
      <p class="delete-dialog__text">{{ deleting ? $t('creation.deleting_text') : delayed ? $t('creation.delete_line_pending_text') : $t('creation.delete_text') }}</p>

      <div v-if="!deleting" class="delete-line__products" name="delete-line-products">
        <p v-if="loadingProducts" class="delete-line__empty">
          <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ $t('creation.delete_line_loading') }}
        </p>
        <p v-else-if="!products.length" class="delete-line__empty">{{ $t('creation.delete_line_none') }}</p>
        <template v-else>
          <div class="delete-line__head">
            <span class="delete-line__label">{{ $t('creation.delete_line_products') }}</span>
            <label class="delete-line__all">
              <Checkbox :model-value="allSelected" binary name="delete-line-all" @update:model-value="toggleAll" />
              <span>{{ $t('creation.delete_line_select_all') }}</span>
            </label>
          </div>
          <ul class="delete-line__list">
            <li v-for="product in products" :key="product._id">
              <label class="delete-line__row" :class="{ 'delete-line__row--kept': !selected.has(product._id) }">
                <Checkbox
                  :model-value="selected.has(product._id)"
                  binary
                  :name="`delete-line-product-${product._id}`"
                  @update:model-value="toggle(product._id, $event)"
                />
                <span class="delete-line__name">{{ product.name }}</span>
                <span class="delete-line__version">v{{ product.version }}</span>
              </label>
            </li>
          </ul>
          <p class="delete-line__summary">{{ $t('creation.delete_line_summary', { deleted: selected.size, total: products.length }) }}</p>
          <p v-if="keepProductIds.length" class="delete-line__hint">{{ $t('creation.delete_line_keep_hint') }}</p>
        </template>
      </div>

      <div v-if="name && !deleting" class="delete-dialog__type">
        <label class="delete-dialog__type-label" for="delete-line-name">
          {{ $t('creation.type_to_confirm', { name }) }}
        </label>
        <InputText
          id="delete-line-name"
          v-model="typed"
          class="delete-dialog__type-input"
          autocomplete="off"
          spellcheck="false"
          @keydown.enter.prevent="confirm"
        />
      </div>

      <div class="delete-dialog__actions">
        <PrimeButton
          outlined
          severity="secondary"
          :label="$t('labels.no')"
          :disabled="deleting"
          class="delete-dialog__cancel"
          @click="cancel"
        />
        <PrimeButton
          :label="$t('labels.yes')"
          :loading="deleting"
          :disabled="!canConfirm"
          icon="pi pi-trash"
          name="delete-line-confirm"
          class="delete-dialog__confirm"
          @click="confirm"
        />
      </div>
    </div>
  </PrimeDialog>
</template>

<style lang="scss">
.delete-line__products {
  width: 100%;
  margin-top: 16px;
  text-align: left;
}

.delete-line__empty {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-muted);
  text-align: center;
}

.delete-line__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.delete-line__label {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.delete-line__all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--text-muted);
  cursor: pointer;
}

.delete-line__list {
  margin: 0;
  padding: 4px;
  list-style: none;
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--card-border);
  border-radius: 8px;
}

.delete-line__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;

  &:hover { background: var(--status-bad-soft); }

  &--kept .delete-line__name { color: var(--text-muted); }
}

.delete-line__name {
  flex: 1;
  min-width: 0;
  font-size: 0.88rem;
  color: var(--text-heading);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delete-line__version {
  font-family: var(--font-mono, monospace);
  font-size: 0.75rem;
  color: var(--text-muted);
}

.delete-line__summary {
  margin: 8px 0 0;
  font-size: 0.8rem;
  color: var(--text-heading);
}

.delete-line__hint {
  margin: 4px 0 0;
  font-size: 0.78rem;
  line-height: 1.4;
  color: var(--status-warn);
}
</style>
