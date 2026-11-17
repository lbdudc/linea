<script setup>
import { ref, computed, watch } from 'vue'
import packageService from 'src/services/packageService'
import migrationService from 'src/services/migrationService'
import { notify } from 'src/composables/useNotify'
import { describeError } from 'components/modules/describeError'
import ChangelogPanel from 'components/changelog/ChangelogPanel.vue'
import DiagnosticList from 'components/modules/DiagnosticList.vue'
import { fieldOf, rangeFor, withPackageRange, newestFirst, diffPackages, diffLines, isPin } from 'components/modules/pinning'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Select from 'primevue/select'
import Message from 'primevue/message'
import Skeleton from 'primevue/skeleton'
import { compareVersions } from 'src/utils/versions'
import { useT } from 'src/composables/useT'

// Moves the version of one package that a line uses (the line, the package and its versions are given): it says what the change does
// (the packages that move, the feature model, the products that would break) before anything is saved. Used from the package
// (one dialog per line that uses it) and from the line (one per package it has).
const props = defineProps({
  visible: { type: Boolean, default: false },
  lineId: { type: String, required: true },
  lineName: { type: String, default: '' },
  // the package: `kind` is `module` or `metamodel`; `versions` are the published ones
  kind: { type: String, required: true },
  location: { type: String, required: true },
  versions: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:visible', 'saved'])

const t = useT()
const field = computed(() => fieldOf(props.kind))
const options = computed(() => newestFirst(props.versions))
const modes = computed(() => [
  { value: 'compatible', label: t('modules.pin_compatible') },
  { value: 'pin', label: t('modules.pin_exact') },
])

const info = ref(null)
const target = ref(null)
const mode = ref('compatible')
const loading = ref(false)
const analysing = ref(false)
const saving = ref(false)
const error = ref(null)
const check = ref(null)
const impact = ref(null)
// the impact on the products could not be worked out: the change is not known to be safe
const impactFailed = ref(false)

const ranges = computed(() => info.value?.spl?.[field.value] ?? {})
const currentRange = computed(() => ranges.value[props.location] ?? null)
const currentVersion = computed(() => info.value?.packages?.find((p) => p.location === props.location)?.version ?? null)
const proposedRange = computed(() => (target.value ? rangeFor(target.value, mode.value) : null))
const unchanged = computed(() => proposedRange.value === currentRange.value)
// a package that comes in through another one has no range of the line to change
const direct = computed(() => currentRange.value !== null)

const packageDiff = computed(() => (check.value ? diffPackages(info.value?.packages, check.value.packages) : null))
const modelDiff = computed(() => (check.value ? diffLines(info.value?.featureModel, check.value.featureModel) : null))
const breaking = computed(() => impact.value?.summary?.breaking ?? 0)
// what the new version brings, and whether any of it is incompatible
const news = ref(null)
const newsBreaking = computed(() => Boolean(news.value?.breaking))
// only an upgrade has something new to show
const showNews = computed(() => Boolean(target.value) && (!currentVersion.value || compareVersions(target.value, currentVersion.value) > 0))
const loadNews = () => packageService.getChangelog({ kind: props.kind, location: props.location, from: currentVersion.value ?? undefined, to: target.value })
const risky = computed(() => breaking.value > 0 || impactFailed.value || newsBreaking.value)
const blocked = computed(() => !direct.value || unchanged.value || check.value?.ok === false || !check.value)

let asked = 0
const analyse = async () => {
  if (!target.value || !direct.value || unchanged.value) { check.value = null; impact.value = null; impactFailed.value = false; return }
  const mine = ++asked
  const proposed = { [field.value]: withPackageRange(ranges.value, props.location, proposedRange.value) }
  analysing.value = true
  error.value = null
  try {
    const [checked, products] = await Promise.all([
      packageService.checkLineModules({ id: props.lineId, ...proposed }),
      migrationService.impact({ lineId: props.lineId, ...proposed }).catch(() => undefined),
    ])
    if (mine !== asked) return
    check.value = checked
    impact.value = products ?? null
    impactFailed.value = products === undefined
  } catch (e) {
    if (mine !== asked) return
    check.value = null
    impact.value = null
    error.value = describeError(e, t).message
  } finally {
    if (mine === asked) analysing.value = false
  }
}

const load = async () => {
  loading.value = true
  error.value = null
  check.value = null
  impact.value = null
  impactFailed.value = false
  try {
    info.value = await packageService.getLineModules({ id: props.lineId })
    const range = currentRange.value
    // starts from the newest version, unless the line already has it
    const pinned = options.value.find((v) => v === currentVersion.value)
    target.value = (options.value[0] && options.value[0] !== pinned ? options.value[0] : pinned) ?? options.value[0] ?? null
    mode.value = range && isPin(range) ? 'pin' : 'compatible'
  } catch (e) {
    error.value = describeError(e, t).message
  } finally {
    loading.value = false
  }
  // (setting the version above is what makes the watch analyse it)
}

const save = async () => {
  saving.value = true
  error.value = null
  try {
    await packageService.saveLineModules({ id: props.lineId, [field.value]: withPackageRange(ranges.value, props.location, proposedRange.value), bump: 'minor' })
    notify({ type: 'positive', message: t('modules.pin_saved', { line: props.lineName, version: target.value }) })
    emit('saved')
    emit('update:visible', false)
  } catch (e) {
    error.value = describeError(e, t).message
  } finally {
    saving.value = false
  }
}

watch(() => props.visible, (open) => { if (open) load() }, { immediate: true })
watch([target, mode], analyse)
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="$t('modules.pin_title', { line: lineName })"
    :style="{ width: '44rem' }"
    @update:visible="emit('update:visible', $event)"
  >
    <Skeleton v-if="loading" height="140px" />
    <div v-else class="pin" data-test="pin-dialog">
      <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
      <Message v-if="info && !direct" severity="info" :closable="false">{{ $t('modules.pin_indirect') }}</Message>

      <dl class="pin__now">
        <dt>{{ $t('modules.pin_now') }}</dt>
        <dd class="ident">{{ currentRange ?? '—' }} <span v-if="currentVersion">→ v{{ currentVersion }}</span></dd>
      </dl>

      <div class="pin__form">
        <label class="pin__field">
          <span>{{ $t('modules.pin_version') }}</span>
          <Select v-model="target" :options="options" :placeholder="$t('modules.unpublished')" :disabled="!direct" />
        </label>
        <label class="pin__field">
          <span>{{ $t('modules.pin_how') }}</span>
          <Select v-model="mode" :options="modes" option-value="value" option-label="label" :disabled="!direct" />
        </label>
      </div>

      <ChangelogPanel
        v-if="showNews"
        :key="`${currentVersion}-${target}`"
        name="pin-changelog"
        open
        :label="$t('changelog.pin_new', { version: target })"
        :load="loadNews"
        @loaded="news = $event"
      />

      <Skeleton v-if="analysing" height="90px" />
      <template v-else-if="check">
        <section class="pin__block">
          <h3>{{ $t('modules.pin_changes') }}</h3>
          <p v-if="packageDiff.same && !modelDiff.added.length && !modelDiff.removed.length" class="pin__quiet">{{ $t('modules.pin_nothing') }}</p>
          <ul v-else class="pin__changes" role="list">
            <li v-for="p in packageDiff.changed" :key="`c${p.location}`"><i class="pi pi-arrow-right" aria-hidden="true" /> <span class="ident">{{ p.name }}</span> v{{ p.from }} → v{{ p.to }}</li>
            <li v-for="p in packageDiff.added" :key="`a${p.location}`" class="pin__add"><i class="pi pi-plus" aria-hidden="true" /> <span class="ident">{{ p.name }}</span> v{{ p.version }}</li>
            <li v-for="p in packageDiff.removed" :key="`r${p.location}`" class="pin__del"><i class="pi pi-minus" aria-hidden="true" /> <span class="ident">{{ p.name }}</span> v{{ p.version }}</li>
          </ul>
          <pre v-if="modelDiff.added.length || modelDiff.removed.length" class="pin__fm ident"><template v-for="(l, i) in modelDiff.removed" :key="`x${i}`"><span class="pin__del">- {{ l }}
</span></template><template v-for="(l, i) in modelDiff.added" :key="`y${i}`"><span class="pin__add">+ {{ l }}
</span></template></pre>
        </section>

        <DiagnosticList :diagnostics="check.diagnostics ?? []" />

        <Message v-if="impactFailed" severity="warn" :closable="false" data-test="pin-impact-failed">{{ $t('modules.pin_impact_failed') }}</Message>

        <section v-if="impact" class="pin__block" data-test="pin-impact">
          <h3>{{ $t('modules.pin_impact') }}</h3>
          <Message v-if="breaking" severity="warn" :closable="false">{{ $t('labels.impact_has_breaking', { n: breaking }) }}</Message>
          <p v-else class="pin__quiet">{{ $t('labels.impact_safe') }}</p>
          <ul class="pin__changes" role="list">
            <li v-for="p in impact.products.filter((x) => x.impact !== 'unaffected_valid' && x.impact !== 'unaffected_invalid')" :key="p.productId">
              <span class="ident">{{ p.name }}</span> — {{ $t(`labels.impact_${p.impact}`) }}<span v-if="p.reason">: {{ p.reason }}</span>
            </li>
          </ul>
        </section>
      </template>
    </div>

    <template #footer>
      <Button text :label="$t('labels.cancel')" @click="emit('update:visible', false)" />
      <Button
        name="confirm-pin"
        icon="pi pi-check"
        :label="risky ? $t('modules.pin_anyway') : $t('modules.pin_apply')"
        :severity="risky ? 'warn' : undefined"
        :loading="saving"
        :disabled="blocked || analysing"
        @click="save"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.pin { display: flex; flex-direction: column; gap: 14px; }
.pin__now { display: flex; gap: 12px; margin: 0; font-size: 13px; }
.pin__now dt { color: var(--p-text-muted-color); }
.pin__now dd { margin: 0; }
.pin__form { display: flex; gap: 12px; }
.pin__field { flex: 1; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.pin__block { display: flex; flex-direction: column; gap: 8px; }
.pin__block h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--p-text-muted-color); }
.pin__quiet { margin: 0; font-size: 13px; color: var(--p-text-muted-color); }
.pin__changes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.pin__fm { margin: 0; padding: 8px 10px; max-height: 200px; overflow: auto; font-size: 12px; border: 1px solid var(--p-content-border-color); border-radius: 6px; }
.pin__add { color: var(--status-good, #2e7d32); }
.pin__del { color: var(--status-bad); }
</style>
