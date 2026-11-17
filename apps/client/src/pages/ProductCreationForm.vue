<script>
import productService from '../services/productService'
import store from 'stores/productState'
import Button from 'primevue/button'
import Message from 'primevue/message'
import FloatLabel from 'primevue/floatlabel'
import InputText from 'primevue/inputtext'
import RadioButton from 'primevue/radiobutton'
import Divider from 'primevue/divider'
import ProgressOverlay from 'components/common/ProgressOverlay.vue'

export default {
  name: 'ProductCreationForm',
  components: { PrimeButton: Button, Message, FloatLabel, InputText, RadioButton, Divider, ProgressOverlay },
  props: {
    id:       { type: String, required: true },
    renaming: { type: Boolean, required: false, default: false },
  },
  data() {
    return {
      name:          this.renaming ? store.basicData.name : '',
      version:       this.renaming ? store.basicData.version : '0.0.0',
      error:         null,
      loadingButton: false,
      store,
    }
  },
  methods: {
    async createProduct() {
      try {
        this.loadingButton = true
        this.name = this.name.replace(/\s+/g, '')

        let product
        if (this.renaming) {
          product = await productService.renameProduct({ id: this.id, name: this.name })
        } else if (this.$route.query.duplicating) {
          product = await productService.duplicateProduct({
            name: this.name,
            version: this.version,
            spec: this.store.getSpec(),
            lineId: this.id,
          })
        } else {
          product = await productService.createProduct({
            name: this.name,
            version: this.version,
            lineId: this.id,
          })
        }

        // replace: going back from the new product must not land on the filled-in form again
        await this.$router.replace(`/products/${product._id}`)
      } catch (error) {
        this.error = error.response?.data?.error || 'error_messages.internal_error'
      } finally {
        this.loadingButton = false
      }
    },
  },
}
</script>

<template>
  <div class="form-page-outer">
    <ProgressOverlay
      :active="loadingButton && !renaming"
      :title="$t('creation.product_title')"
      :hint="$t('creation.product_hint')"
      :steps="[1, 2, 3, 4, 5].map((n) => $t(`creation.product_step_${n}`))"
      :step-ms="1500"
    />
    <div class="form-page-card app-card">
      <div class="form-header">
        <div class="form-header__row">
          <PrimeButton
            text rounded size="small"
            class="form-header__back-btn"
            :aria-label="$t('labels.cancel')"
            icon="pi pi-arrow-left"
            @click="$router.go(-1)"
          />
          <div class="form-title">
            {{ renaming ? $t('labels.product_rename') : $t('labels.product_add') }}
          </div>
        </div>
      </div>

      <Divider class="form-sep" />

      <div class="form-body">
        <Message
          v-if="error"
          severity="error"
          :closable="false"
          class="form-body__error"
        >
          <template #icon><i class="pi pi-exclamation-circle" style="font-size: 18px" aria-hidden="true"></i></template>
          {{ $t(error) }}
        </Message>

        <form class="form-body__fields" @submit.prevent="createProduct">
          <FloatLabel variant="on" class="form-field">
            <InputText id="prod-name" v-model="name" name="name" required class="form-field__input" />
            <label for="prod-name">{{ $t('labels.name') }}</label>
          </FloatLabel>

          <FloatLabel variant="on" class="form-field">
            <InputText id="prod-version" v-model="version" name="version" disabled readonly class="form-field__input" />
            <label for="prod-version">{{ $t('labels.version') }}</label>
          </FloatLabel>

          <div
            v-if="$route.query.duplicating && store && store.basicData.version !== '0.0.0'"
            class="version-choice"
          >
            <div class="form-label">{{ $t('labels.version') }}</div>
            <label class="version-choice__radio">
              <RadioButton v-model="version" value="0.0.0" />
              <span>{{ $t('labels.restore_version') }}</span>
            </label>
            <label class="version-choice__radio">
              <RadioButton v-model="version" :value="store.basicData.version" />
              <span>{{ $t('labels.keep_version') }}</span>
            </label>
          </div>

          <div class="form-actions">
            <PrimeButton
              text
              :label="$t('labels.cancel')"
              :style="{ color: 'var(--text-muted)' }"
              @click="$router.go(-1)"
            />
            <PrimeButton
              type="submit"
              :label="renaming ? $t('labels.rename') : $t('labels.create')"
              :loading="loadingButton"
            />
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.form-header {
  padding: 16px 20px 14px;

  &__row {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 8px;
  }

  &__back-btn {
    color: var(--text-muted) !important;
  }
}

.form-sep {
  margin: 0;
}

.form-body {
  padding: 24px;

  &__error {
    margin-bottom: 24px;
  }

  &__fields {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
}

.form-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-heading);
}

.form-field {
  display: block;

  :deep(.form-field__input) { width: 100%; }
}

.form-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.version-choice {
  padding: 12px 16px;
  background: var(--surface-alt);
  border-radius: 8px;
  border: 1px solid var(--card-border);

  &__radio {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    cursor: pointer;
  }
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
}
</style>
