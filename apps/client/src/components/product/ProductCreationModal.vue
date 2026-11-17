<template>
  <PrimeDialog
    v-model:visible="isOpen"
    modal
    :show-header="false"
    :closable="false"
    :close-on-escape="false"
    class="pcmod-dialog"
    style="width: 400px; max-width: 96vw"
  >
    <Message v-if="error" severity="error" :closable="false" class="pcmod-error">
      {{ "Error: " + $t(error) }}
    </Message>

    <div class="pcmod-title">
      {{ renaming ? $t('labels.product_rename') : $t('labels.product_add') }}
    </div>

    <form @submit.prevent="createProduct">
      <FloatLabel variant="on" class="pcmod-field">
        <InputText id="pcmod-name" v-model="name" name="name" required class="pcmod-input" />
        <label for="pcmod-name">{{ $t('labels.name') }}</label>
      </FloatLabel>

      <FloatLabel variant="on" class="pcmod-field">
        <InputText id="pcmod-version" v-model="version" name="version" disabled readonly class="pcmod-input" />
        <label for="pcmod-version">{{ $t('labels.version') }}</label>
      </FloatLabel>

      <div
        v-if="$route.query.duplicating && store && store.basicData.version !== '0.0.0'"
        class="pcmod-radios"
      >
        <label class="pcmod-radio">
          <RadioButton v-model="version" value="0.0.0" />
          <span>{{ $t('labels.restore_version') }}</span>
        </label>
        <label class="pcmod-radio">
          <RadioButton v-model="version" :value="store.basicData.version" />
          <span>{{ $t('labels.keep_version') }}</span>
        </label>
      </div>

      <div class="pcmod-actions">
        <PrimeButton
          type="button"
          :label="$t('labels.cancel')"
          text
          class="pcmod-cancel-btn"
          @click="closeModal"
        />
        <PrimeButton
          type="submit"
          :label="renaming ? $t('labels.rename') : $t('labels.create')"
          :loading="loadingButton"
        />
      </div>
    </form>
  </PrimeDialog>
</template>

<script>
import productService from "../../services/productService";
import store from "stores/productState";
import { notify } from 'src/composables/useNotify';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import FloatLabel from 'primevue/floatlabel';
import InputText from 'primevue/inputtext';
import RadioButton from 'primevue/radiobutton';
import Button from 'primevue/button';

export default {
  name: "ProductCreationModal",
  components: { PrimeDialog: Dialog, Message, FloatLabel, InputText, RadioButton, PrimeButton: Button },
  props: {
    renaming: {
      type: Boolean,
      default: false,
    },
    visible: {
      type: Boolean,
      default: false,
    },
    configurations:{
      required: true,
      type: [Array, Object],
    },
  },
  data() {
    return {
      isOpen: this.visible,
      name: this.renaming ? store.basicData.name : "",
      version: this.renaming ? store.basicData.version : "0.0.0",
      error: null,
      loadingButton: false,
      store,
    };
  },
  watch: {
    visible(val) {
      this.isOpen = val;
    },
    isOpen(val) {
      if (!val) this.$emit("close");
    },
  },
  methods: {
    closeModal() {
      this.isOpen = false;
    },
    async createProduct() {
      try {
        this.loadingButton = true;
        this.name = this.name.replace(/\s+/g, "");

        let product;
        product = await productService.createProdWithConfig({
          name: this.name,
          version: this.version,
          lineId: this.$route.params.id,
          features: this.configurations,
        });

        this.$emit("product-created", product);
        this.closeModal();
        this.$router.push(`/products/${product._id}`);
      } catch (error) {
        this.error = error.response?.data?.error || 'error_messages.internal_error';
        notify({
          type: 'negative',
          message: this.$t(this.error),
          position: 'bottom-right',
          timeout: 1500,
        });
      } finally {
        this.loadingButton = false;
      }
    },
  },
};
</script>

<style scoped lang="scss">

.pcmod-error {
  margin-bottom: 16px;
}

.pcmod-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-heading);
  margin-bottom: 16px;
}

.pcmod-field {
  display: block;
  margin-bottom: 20px;

  .pcmod-input { width: 100%; }
}

.pcmod-radios {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.pcmod-radio {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.pcmod-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
}

.pcmod-cancel-btn {
  color: var(--text-muted) !important;
}
</style>
