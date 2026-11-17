<template>
  <PrimeDialog
    v-model:visible="show"
    modal
    :closable="false"
    :close-on-escape="false"
    class="generation-record"
    :style="dialogStyle"
    @hide="$emit('close-dialog')"
  >
    <template #header>
      <div class="generation-record__header">
        <div class="generation-record__spacer" />
        <PrimeButton
          text rounded size="small"
          class="generation-record__header-btn"
          :icon="maximizedToggle ? 'pi pi-window-minimize' : 'pi pi-window-maximize'"
          v-tooltip.bottom="maximizedToggle ? $t('labels.demaximize') : $t('labels.maximize')"
          @click="maximizedToggle = !maximizedToggle"
        />
        <PrimeButton
          text rounded size="small"
          class="generation-record__header-btn"
          icon="pi pi-times"
          v-tooltip.bottom="$t('labels.close')"
          @click="closeDialog"
        />
      </div>
    </template>

    <div class="generation-record__body">
      <FloatLabel variant="on" class="generation-record__select">
        <PrimeSelect
          id="generation-record-version"
          v-model="selected"
          :options="versions"
          class="generation-record__select-input"
          @update:model-value="handleSelectChange"
        />
        <label for="generation-record-version">{{ $t('labels.version') }}</label>
      </FloatLabel>

      <div v-if="versions.length === 0" class="generation-record__empty">
        <i class="pi pi-exclamation-triangle" style="font-size: 34px" aria-hidden="true" />
        {{ $t('labels.no_data_available') }}
      </div>

      <div v-for="(log, index) in messages" :key="index" class="generation-record__log">
        <LogItem :log="log" />
        <Divider class="generation-record__sep" />
      </div>
    </div>
  </PrimeDialog>
</template>

<script>
import logService from 'src/services/logService';
import LogItem from '../common/LogItem.vue';
import Dialog from 'primevue/dialog';
import FloatLabel from 'primevue/floatlabel';
import Select from 'primevue/select';
import Divider from 'primevue/divider';
import Button from 'primevue/button';
import Tooltip from 'primevue/tooltip';

export default {
  name: 'GenerationRecord',
  components: {
    LogItem,
    PrimeDialog: Dialog,
    FloatLabel,
    PrimeSelect: Select,
    Divider,
    PrimeButton: Button,
  },
  directives: { tooltip: Tooltip },
  props: {
    id:     { type: String,  required: true },
    dialog: { type: Boolean, required: true },
  },
  data() {
    return {
      // Igual que en el original: se mantiene en modo "maximizado" por defecto,
      // el propio botón lo cambia entre pantalla completa y tamaño normal.
      maximizedToggle: true,
      show: this.dialog,
      selected: null,
      versions: [],
      messages: [],
    };
  },
  computed: {
    dialogStyle() {
      return this.maximizedToggle
        ? { width: '100vw', height: '100vh', maxHeight: '100%', borderRadius: '0' }
        : { width: '900px', maxWidth: '96vw' };
    },
  },
  watch: {
    dialog: async function (newValue) {
      if (newValue) {
        this.versions = await logService.findVersions({ id: this.id });
        this.selected = this.versions[0];
        this.messages = await logService.find({ id: this.id, version: this.selected });
      }
      this.show = newValue;
    },
  },
  methods: {
    closeDialog() {
      this.show = false;
    },
    async handleSelectChange() {
      this.messages = await logService.find({ id: this.id, version: this.selected });
    },
  },
};
</script>

<style scoped lang="scss">
.generation-record {
  &__header {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 32px;
  }

  &__spacer { flex: 1; }

  &__header-btn {
    color: var(--p-primary-contrast-color) !important;
  }

  &__body {
    padding: 16px;
  }

  &__select {
    display: block;
    margin-bottom: 16px;

    :deep(.generation-record__select-input) { width: 100%; }
  }

  &__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    text-align: center;
    padding: 16px;
    color: var(--text-muted);
  }

  &__log {
    &:last-child .generation-record__sep { display: none; }
  }

  &__sep {
    margin: 8px 16px;
  }
}
</style>

<style lang="scss">
.generation-record .p-dialog-header {
  background: var(--p-button-primary-background);
  color: var(--p-primary-contrast-color);
  padding: 4px 8px;
}

.generation-record .p-dialog-content {
  padding: 0;
}
</style>
