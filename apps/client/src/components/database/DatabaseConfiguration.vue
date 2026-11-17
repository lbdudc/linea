<template>
  <div class="db-config">
    <div class="db-config__grid">
      <div class="db-config__cell db-config__cell--3">
        <FloatLabel variant="on" class="db-config__field">
          <InputText id="db-host" v-model="innerConfig.host" class="db-config__input" />
          <label for="db-host">{{ $t('database.hostname') }}</label>
        </FloatLabel>
      </div>
      <div class="db-config__cell db-config__cell--2">
        <FloatLabel variant="on" class="db-config__field">
          <InputText id="db-port" v-model="innerConfig.port" type="number" class="db-config__input" />
          <label for="db-port">{{ $t('database.port') }}</label>
        </FloatLabel>
      </div>
      <div class="db-config__cell db-config__cell--3">
        <FloatLabel variant="on" class="db-config__field">
          <InputText id="db-database" v-model="innerConfig.database" class="db-config__input" />
          <label for="db-database">{{ $t('database.database') }}</label>
        </FloatLabel>
      </div>
      <div class="db-config__cell db-config__cell--2">
        <FloatLabel variant="on" class="db-config__field">
          <InputText id="db-username" v-model="innerConfig.username" class="db-config__input" />
          <label for="db-username">{{ $t('database.username') }}</label>
        </FloatLabel>
      </div>
      <div class="db-config__cell db-config__cell--2">
        <FloatLabel variant="on" class="db-config__field">
          <InputText id="db-password" v-model="innerConfig.password" class="db-config__input" />
          <label for="db-password">{{ $t('database.password') }}</label>
        </FloatLabel>
      </div>
    </div>
  </div>
</template>

<script>
import { reactive, watch } from 'vue';
import FloatLabel from 'primevue/floatlabel';
import InputText from 'primevue/inputtext';

export default {
  components: { FloatLabel, InputText },
  props: {
    config: {
      type: Object,
      required: true,
    },
  },
  setup(props, { emit }) {
    const innerConfig = reactive({ ...props.config });

    watch(() => innerConfig, (newValue) => {
      emit('update-config', newValue);
    }, { deep: true });

    return { innerConfig };
  },
};
</script>

<style scoped lang="scss">
.db-config {
  margin: 0;

  &__grid {
    display: flex;
    flex-wrap: wrap;
    row-gap: 8px;
  }

  &__cell {
    box-sizing: border-box;
    padding-right: 8px;
  }

  &__cell--3 { width: 25%; }

  &__cell--2 { width: 16.6667%; }

  &__field {
    display: block;

    :deep(.db-config__input) { width: 100%; }
  }
}
</style>
