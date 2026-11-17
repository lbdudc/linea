<script setup>
// The generation of a product at a glance, as one cell of the strip on the overview: the deployed version and whether the saved spec has
// changes that no generation has deployed. It only shows; the page does what its links ask.
defineProps({
  /** The deployed version, if there is one. */
  version: { type: String, default: null },
  /** There are saved changes that no generation has deployed. */
  pending: { type: Boolean, default: false },
  /** The version a generation would make. */
  nextVersion: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})
defineEmits(['generate', 'diff'])
</script>

<template>
  <div class="ln-strip__cell" name="product-generation-card">
    <span class="ln-strip__label">{{ $t('automation.generation') }}<template v-if="version"> · v{{ version }}</template></span>
    <strong class="ln-strip__value" :class="{ 'ln-strip__value--warn': pending }" name="state-changes">
      {{ pending ? $t('labels.state_pending') : $t('labels.state_up_to_date') }}
    </strong>
    <span class="ln-strip__sub" name="state-version">
      {{ pending && nextVersion ? $t('automation.next_version', { version: nextVersion }) : (version ? $t('labels.state_saved_is_deployed') : $t('labels.state_never')) }}
    </span>
    <span class="ln-strip__links">
      <button v-if="pending" type="button" class="ln-link" name="generation-diff" @click="$emit('diff')">{{ $t('generation.diff_action') }}</button>
      <button type="button" class="ln-link" :disabled="disabled" name="generation-generate" @click="$emit('generate')">
        {{ pending && nextVersion ? $t('automation.generate_version', { version: nextVersion }) : $t('labels.generate') }}
      </button>
    </span>
  </div>
</template>
