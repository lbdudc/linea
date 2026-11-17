<template>
  <v-dialog persistent width="500" :value="dialog">
    <v-card>
      <!-- Título -->
      <v-card-title primary-title class="headline" :class="titleClass">
        <v-icon v-if="titleIcon" class="mr-4" :class="titleClass">
          {{ titleIcon }}
        </v-icon>
        {{ title }}
      </v-card-title>

      <!-- Contenido -->
      <v-card-text class="mt-4">
        <slot name="content">{{ content }}</slot>
      </v-card-text>

      <!-- Acciones -->
      <v-card-actions class="pb-4">
        <v-spacer></v-spacer>
        <v-btn :class="cancelClass" @click="onCancel">
          {{ cancelText || $t('cancel') }}
        </v-btn>
        <v-btn
          v-if="submitText"
          class="mx-4"
          :class="submitClass"
          @click="onSubmit"
        >
          {{ submitText }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: 'ModalDialog',

  props: {
    dialog: { type: Boolean, required: true },
    title: { type: String, default: '' },
    titleIcon: { type: String, default: '' },
    titleClass: { type: String, default: '' },
    content: { type: String, default: '' },
    cancelText: { type: String, default: '' },
    cancelClass: { type: String, default: '' },
    submitText: { type: String, default: '' },
    submitClass: { type: String, default: '' }
  },

  methods: {
    onCancel() {
      this.$emit('cancel')
    },
    onSubmit() {
      this.$emit('submit')
    }
  }
}
</script>
