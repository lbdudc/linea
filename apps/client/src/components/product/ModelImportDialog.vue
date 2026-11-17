<script setup>
import { computed } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import DiagnosticList from 'components/modules/DiagnosticList.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  report: { type: Object, default: null },
})
const emit = defineEmits(['update:visible'])

const updated = computed(() => props.report?.updated ?? [])
const invalid = computed(() => props.report?.invalid ?? [])
const failed = computed(() => props.report?.errors ?? [])
const skipped = computed(() => props.report?.skipped ?? [])
const untouched = computed(() => props.report?.untouched ?? [])
const after = computed(() => props.report?.after ?? null)
const nothing = computed(() => !updated.value.length && !invalid.value.length && !failed.value.length)
</script>

<template>
  <Dialog :visible="visible" modal :header="$t('modules.import_title')" :style="{ width: 'min(640px, 94vw)' }" data-test="model-import-dialog" @update:visible="emit('update:visible', $event)">
    <div class="mid">
      <p class="mid__lead">{{ report?.transformed ? $t('modules.import_transformed') : $t('modules.import_as_is') }}</p>

      <section v-if="updated.length" class="mid__sec" data-test="import-updated">
        <h4 class="mid__h"><i class="pi pi-check-circle mid__ok" aria-hidden="true" /> {{ $t('modules.import_updated', { n: updated.length }, updated.length) }}</h4>
        <div class="mid__chips"><span v-for="name in updated" :key="name" class="mid__chip ident">{{ name }}</span></div>
      </section>

      <section v-if="invalid.length" class="mid__sec" data-test="import-invalid">
        <h4 class="mid__h"><i class="pi pi-exclamation-triangle mid__warn" aria-hidden="true" /> {{ $t('modules.import_invalid', { n: invalid.length }, invalid.length) }}</h4>
        <p class="mid__hint">{{ $t('modules.import_invalid_hint') }}</p>
        <details v-for="item in invalid" :key="item.metamodel" class="mid__item">
          <summary><span class="ident">{{ item.metamodel }}</span> <span class="mid__muted">{{ $t('modules.model_errors', { n: item.count }) }}</span></summary>
          <ul class="mid__list"><li v-for="(error, i) in item.errors" :key="i" class="ident">{{ error }}</li></ul>
        </details>
      </section>

      <section v-if="failed.length" class="mid__sec" data-test="import-failed">
        <h4 class="mid__h"><i class="pi pi-times-circle mid__bad" aria-hidden="true" /> {{ $t('modules.import_failed', { n: failed.length }, failed.length) }}</h4>
        <ul class="mid__list"><li v-for="(error, i) in failed" :key="i">{{ error }}</li></ul>
      </section>

      <section v-if="untouched.length" class="mid__sec" data-test="import-untouched">
        <h4 class="mid__h">{{ $t('modules.import_untouched') }}</h4>
        <div class="mid__chips"><span v-for="name in untouched" :key="name" class="mid__chip mid__chip--muted ident">{{ name }}</span></div>
      </section>

      <section v-if="skipped.length" class="mid__sec" data-test="import-skipped">
        <h4 class="mid__h">{{ $t('modules.import_skipped') }}</h4>
        <div class="mid__chips"><span v-for="name in skipped" :key="name" class="mid__chip mid__chip--muted ident">{{ name }}</span></div>
      </section>

      <p v-if="nothing" class="mid__muted" data-test="import-nothing">{{ $t('modules.import_nothing') }}</p>

      <section v-if="after" class="mid__sec" data-test="import-after">
        <h4 class="mid__h">{{ $t('modules.import_after') }}</h4>
        <p v-if="after.ok" class="mid__okline"><i class="pi pi-check-circle" aria-hidden="true" /> {{ $t('modules.import_after_ok') }}</p>
        <DiagnosticList v-else :diagnostics="after.diagnostics" />
      </section>
    </div>
    <template #footer>
      <Button :label="$t('labels.close')" size="small" @click="emit('update:visible', false)" />
    </template>
  </Dialog>
</template>

<style scoped>
.mid { display: flex; flex-direction: column; gap: 14px; }
.mid__lead, .mid__hint { margin: 0; font-size: 13px; color: var(--p-text-muted-color); }
.mid__sec { display: flex; flex-direction: column; gap: 6px; }
.mid__h { margin: 0; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.mid__ok, .mid__okline { color: var(--status-ok); }
.mid__okline { margin: 0; font-size: 13px; display: flex; align-items: center; gap: 6px; }
.mid__warn { color: var(--status-warn); }
.mid__bad { color: var(--status-bad); }
.mid__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.mid__chip { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: var(--p-content-hover-background); }
.mid__chip--muted { color: var(--p-text-muted-color); }
.mid__item { border: 1px solid var(--p-content-border-color); border-radius: 6px; padding: 6px 10px; }
.mid__item summary { cursor: pointer; font-size: 13px; }
.mid__list { margin: 6px 0 0; padding-left: 18px; font-size: 12px; }
.mid__muted { font-size: 12px; color: var(--p-text-muted-color); }
</style>
