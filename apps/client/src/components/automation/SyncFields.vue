<script setup>
import { computed } from 'vue'
import SelectButton from 'primevue/selectbutton'
import Select from 'primevue/select'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'
import InfoHint from 'src/components/common/InfoHint.vue'
import { useT } from 'src/composables/useT'

// The rows of how something syncs: when (a preset or a cron expression) and what it does with the drift it finds. The SPL sets it for its
// products (`scope="line"`: it is on or off); a product follows the SPL, has its own, or is off (`scope="product"`) and may leave the behavior
// to the SPL. The rows go inside a `.ln-block`.
const props = defineProps({
  modelValue: { type: Object, required: true },
  scope: { type: String, default: 'line' },
  /** What a product inherits, to show next to "follow the SPL". */
  inheritedText: { type: String, default: '' },
  readOnly: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])
const t = useT()

const patch = (changes) => emit('update:modelValue', { ...props.modelValue, ...changes })
const PRESETS = ['1h', '3h', '6h', '12h', '24h', 'weekly', 'cron']
const presets = computed(() => PRESETS.map((value) => ({ value, label: t(`automation.preset_${value}`) })))
const modes = computed(() => ['inherit', 'custom', 'off'].map((value) => ({ value, label: t(`automation.mode_${value}`) })))
const behaviors = computed(() => [...(props.scope === 'product' ? ['inherit'] : []), 'check', 'mr', 'merge'].map((value) => ({ value, label: t(`automation.behavior_${value}`) })))
const scheduled = computed(() => (props.scope === 'line' ? props.modelValue.enabled : props.modelValue.mode === 'custom'))
</script>

<template>
  <div v-if="scope === 'line'" class="ln-row">
    <label for="sync-enabled" class="ln-row__label">{{ $t('automation.sync_auto') }}<InfoHint :text="$t('automation.sync_auto_hint')" /></label>
    <div class="ln-row__control">
      <span name="sync-enabled"><ToggleSwitch :disabled="readOnly" :model-value="modelValue.enabled" input-id="sync-enabled" @update:model-value="patch({ enabled: $event })" /></span>
    </div>
  </div>

  <div v-else class="ln-row">
    <span class="ln-row__label">{{ $t('automation.frequency') }}<InfoHint :text="$t('automation.frequency_hint')" /></span>
    <div class="ln-row__control">
      <span name="sync-mode">
        <SelectButton :disabled="readOnly" :model-value="modelValue.mode" :options="modes" option-label="label" option-value="value" :allow-empty="false" size="small" @update:model-value="patch({ mode: $event })" />
      </span>
      <span v-if="modelValue.mode === 'inherit' && inheritedText" class="ln-row__note">{{ inheritedText }}</span>
      <template v-if="modelValue.mode === 'custom'">
        <span name="sync-preset">
        <Select :disabled="readOnly" :model-value="modelValue.preset" :options="presets" option-label="label" option-value="value" size="small" :aria-label="$t('automation.frequency')" @update:model-value="patch({ preset: $event })" />
      </span>
      <InputText
        v-if="modelValue.preset === 'cron'"
        :readonly="readOnly" :model-value="modelValue.cron" size="small" class="sync-cron" name="sync-cron" spellcheck="false"
        :placeholder="$t('automation.cron_placeholder')" :aria-label="$t('automation.preset_cron')"
        @update:model-value="patch({ cron: $event })"
      />
      </template>
    </div>
  </div>

  <div v-if="scheduled && scope === 'line'" class="ln-row">
    <span class="ln-row__label">{{ $t('automation.frequency') }}<InfoHint :text="$t('automation.cron_hint')" /></span>
    <div class="ln-row__control">
      <span name="sync-preset">
        <Select :disabled="readOnly" :model-value="modelValue.preset" :options="presets" option-label="label" option-value="value" size="small" :aria-label="$t('automation.frequency')" @update:model-value="patch({ preset: $event })" />
      </span>
      <InputText
        v-if="modelValue.preset === 'cron'"
        :readonly="readOnly" :model-value="modelValue.cron" size="small" class="sync-cron" name="sync-cron" spellcheck="false"
        :placeholder="$t('automation.cron_placeholder')" :aria-label="$t('automation.preset_cron')"
        @update:model-value="patch({ cron: $event })"
      />
    </div>
  </div>

  <div class="ln-row">
    <span class="ln-row__label">{{ $t('automation.behavior') }}<InfoHint :text="$t('automation.behavior_hint')" /></span>
    <div class="ln-row__control">
      <span name="sync-behavior">
        <SelectButton :disabled="readOnly" :model-value="modelValue.behavior" :options="behaviors" option-label="label" option-value="value" :allow-empty="false" size="small" @update:model-value="patch({ behavior: $event })" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.sync-cron { width: 11rem; font-family: var(--p-font-mono, monospace); }
</style>
