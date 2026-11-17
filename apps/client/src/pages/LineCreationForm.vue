<script>
import lineService from '../services/lineService'
import Button from 'primevue/button'
import Message from 'primevue/message'
import FloatLabel from 'primevue/floatlabel'
import InputText from 'primevue/inputtext'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import Select from 'primevue/select'
import Divider from 'primevue/divider'
import Tooltip from 'primevue/tooltip'
import Stepper from 'primevue/stepper'
import StepList from 'primevue/steplist'
import Step from 'primevue/step'
import StepPanels from 'primevue/steppanels'
import StepPanel from 'primevue/steppanel'
import ProgressOverlay from 'components/common/ProgressOverlay.vue'
import { lineKinds } from 'components/modules/lineKinds'
import { state } from 'stores/userState'
import { gitHosts, loadGitHosts } from 'stores/gitHosts'
import { hostName } from 'src/boot/gitHost'
import GitHostIcon from 'components/common/GitHostIcon.vue'
import KindDiagram from 'components/line/KindDiagram.vue'
import CreationSummary from 'components/line/CreationSummary.vue'

// the group used last time, per git host (a group of one host means nothing on another)
const LAST_NAMESPACE = 'linea.lastNamespace'
const lastKey = (host) => (host ? `${LAST_NAMESPACE}.${host}` : LAST_NAMESPACE)

// the greyed fourth step of the kinds that have nothing to choose: only there to keep the stepper the same size
const PLACEHOLDER_STEP = 99

export default {
  name: 'LineCreationForm',
  components: {
    IconField,
    InputIcon,
    KindDiagram,
    CreationSummary,
    PrimeButton: Button,
    Message,
    FloatLabel,
    InputText,
    PrimeSelect: Select,
    Divider,
    Stepper,
    StepList,
    Step,
    StepPanels,
    StepPanel,
    ProgressOverlay,
    GitHostIcon,
  },
  directives: { tooltip: Tooltip },
  data() {
    return {
      PLACEHOLDER_STEP,
      name: '',
      version: '0.1.0',
      description: '',
      error: null,
      activeStep: 1,
      loadingButton: false,
      // plain: the feature metamodel only; the other kinds are made of metamodels or modules (see `components/modules/lineKinds`)
      kind: 'plain',
      selections: {},
      reports: {},
      // whether the picker of the chosen kind is checking what was chosen
      checkingContents: false,
      // the group shows as missing only once the person has left it empty or tried to go on, not from the start
      groupTouched: false,
      parentNamespaceId: null,
      namespaceOptions: [],
      loadingNamespaces: false,
      // the git host the line is created on (chosen when there is more than one)
      host: null,
    }
  },
  computed: {
    // the kinds besides plain, in their order
    extraKinds() {
      return [...lineKinds].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
    },
    // what the chosen kind is made of (`null` for plain)
    kindDef() {
      return this.extraKinds.find((k) => k.kind === this.kind) ?? null
    },
    selection: {
      get() { return this.selections[this.kind] ?? this.kindDef?.initial?.() ?? [] },
      set(value) { this.selections = { ...this.selections, [this.kind]: value } },
    },
    // what is missing before it can be created, as a message key ('' when nothing is)
    kindBlocker() {
      return this.kindDef?.blocker?.({ selection: this.selection, report: this.reports[this.kind] ?? null }) ?? ''
    },
    // an SPL can be created once what it is made of fits together
    canCreate() {
      return Boolean(this.name.trim()) && this.versionValid && this.namespaceChosen && !this.kindBlocker
    },
    // the kinds sit side by side, and the pickers need room
    wide() {
      return true
    },
    // the steps of the chosen kind: the number of each is its place, and only the kinds made of something have a step to choose it
    steps() {
      // the name and where it goes are one step; the kind has its own; the summary is only to confirm
      const missingDetails = !this.name.trim() ? 'creation.need_name' : !this.versionValid ? 'creation.need_version' : this.namespaceChosen ? '' : 'creation.need_group'
      const details = { key: 'details', title: 'creation.step_details', missing: missingDetails }
      const type = { key: 'type', title: 'creation.step_type', missing: '' }
      const contents = this.kindDef ? [{ key: 'contents', title: this.kindDef.stepTitle, missing: this.kindBlocker }] : []
      const summary = { key: 'summary', title: 'creation.summary_title', missing: '' }
      return [details, type, ...contents, summary].map((step, index) => ({ ...step, value: index + 1 }))
    },
    // the footer hint: always one line, with a state of its own (neutral, loading, warning or ok)
    status() {
      if (this.loadingButton) return { state: 'loading', icon: 'pi pi-spin pi-spinner', text: this.$t('creation.creating') }
      if (this.blocker) {
        const waiting = this.missingHere === 'creation.need_metamodels_check' || (this.activeStep === this.stepNumber('contents') && this.checkingContents)
        const neutral = ['creation.need_name', 'creation.need_version', 'creation.need_group'].includes(this.missingHere)
        return { state: waiting ? 'loading' : neutral ? 'neutral' : 'warning', icon: waiting ? 'pi pi-spin pi-spinner' : neutral ? 'pi pi-info-circle' : 'pi pi-exclamation-triangle', text: this.blocker }
      }
      if (this.onLastStep) return { state: 'ok', icon: 'pi pi-check-circle', text: this.$t('creation.ready') }
      return { state: 'neutral', icon: 'pi pi-info-circle', text: this.$t('creation.step_of', { n: this.activeStep, total: this.steps.length }) }
    },
    // a version as the server reads it (VERSION_PATTERN of the line validators): three numbers
    versionValid() {
      return /^\d+\.\d+\.\d+$/.test(this.version.trim())
    },
    selectedGroup() {
      return this.namespaceOptions.find((o) => o.id === this.parentNamespaceId) ?? null
    },
    // what is about to be created, read-only, each part with the step that edits it
    summary() {
      const ns = this.namespaceOptions.find((o) => o.id === this.parentNamespaceId)
      const rows = [
        { key: 'details', icon: 'pi-tag', label: this.$t('labels.name'), value: this.name.trim() || '—', step: this.stepNumber('details') },
        { key: 'version', icon: 'pi-hashtag', label: this.$t('creation.version_label'), value: this.version.trim() || '—', step: this.stepNumber('details') },
        { key: 'type', icon: 'pi-sitemap', label: this.$t('modules.line_kind'), value: this.$t(this.kindDef ? this.kindDef.label : 'modules.line_plain'), step: this.stepNumber('type') },
      ]
      if (this.kindDef) {
        const chips = this.selection.map((m) => ({ name: m.name ?? m.location.split('/').pop(), range: m.range }))
        rows.push({ key: 'contents', icon: 'pi-th-large', label: this.$t(this.kindDef.stepTitle), value: this.$t('creation.summary_none'), chips, step: this.stepNumber('contents') })
      }
      rows.push({ key: 'location', icon: 'pi-folder', hostId: this.host, label: this.$t('creation.step_location'), value: ns?.fullPath ?? this.$t('creation.summary_no_group'), step: this.stepNumber('details') })
      return rows
    },
    onLastStep() {
      return this.activeStep === this.steps.length
    },
    // what is missing in the step being looked at, as a message key
    missingHere() {
      return this.steps[this.activeStep - 1]?.missing ?? ''
    },
    // what is missing there, in words (nothing when it is complete)
    blocker() {
      return this.missingHere ? this.$t(this.missingHere) : ''
    },
    // a group has to be picked when there are groups to pick from: most accounts cannot create top-level groups, and GitLab then refuses
    // the git hosts this person has an account on (only with more than one is it a choice)
    hostChoices() {
      const mine = new Set(state.user?.hosts ?? [])
      return gitHosts.hosts.filter((h) => mine.has(h.id)).map((h) => ({ id: h.id, linked: true }))
    },
    // a group has to be chosen when there are groups to choose from, except on the host that makes lines where no group is needed
    namespaceRequired() {
      const terms = gitHosts.hosts.find((h) => h.id === this.host)?.terms
      return this.namespaceOptions.length > 0 && terms?.namespaceRequired !== false
    },
    namespaceChosen() {
      return !this.namespaceRequired || (this.parentNamespaceId !== null && this.parentNamespaceId !== undefined)
    },
  },
  async mounted() {
    await loadGitHosts()
    // the remote of their profile (the one in use now), else the primary host if they have an account on it, else the first they have
    const mine = this.hostChoices.filter((h) => h.linked)
    this.host = (mine.find((h) => h.id === state.user?.activeHost) ?? mine.find((h) => h.id === gitHosts.primary) ?? mine[0] ?? this.hostChoices[0])?.id ?? null
    this.loadNamespaces()
  },
  methods: {
    hostName,
    stepNumber(key) {
      return this.steps.find((step) => step.key === key)?.value
    },
    // a step can be opened once all those before it are complete
    stepLocked(step) {
      return this.steps.some((other) => other.value < step.value && other.missing)
    },
    nextStep() {
      if (this.missingHere) this.groupTouched = true
      if (!this.missingHere && !this.onLastStep) this.activeStep += 1
    },
    // Enter: creates from the last step, goes on from the name, and does nothing while choosing in the steps between
    onSubmit() {
      if (this.onLastStep) {
        if (this.canCreate) this.createLine()
      } else if (this.activeStep === this.stepNumber('details')) {
        this.nextStep()
      }
    },
    chooseHost(id) {
      if (id === this.host) return
      this.host = id
      this.parentNamespaceId = null
      this.namespaceOptions = []
      this.loadNamespaces()
    },
    async loadNamespaces() {
      // the answers of a host that is no longer the chosen one are dropped: a slow remote (GitLab can take seconds) must not
      // overwrite the groups of the one picked after it
      const host = this.host
      try {
        this.loadingNamespaces = true
        const namespaces = await lineService.findAvailableNamespaces(host)
        if (host !== this.host) return
        namespaces.sort((a, b) => a.fullPath.localeCompare(b.fullPath))
        this.namespaceOptions = namespaces
        // the one the host is set to (its `defaultNamespace`), when this person can use it; else the group used last time; else the only one there is
        let last = null
        try { last = window.localStorage.getItem(lastKey(host)) } catch { /* no storage: nothing is remembered */ }
        const preferred = gitHosts.hosts.find((h) => h.id === host)?.defaultNamespace
        const pick = (preferred ? namespaces.find((o) => String(o.id) === preferred || o.fullPath === preferred) : undefined)
          ?? namespaces.find((o) => String(o.id) === last)
          ?? (namespaces.length === 1 ? namespaces[0] : undefined)
        if (pick) this.parentNamespaceId = pick.id
      } catch (error) {
        // Not fatal: the line can still be created as a top-level group.
        console.error('Error loading namespaces:', error)
      } finally {
        if (host === this.host) this.loadingNamespaces = false
      }
    },
    async createLine() {
      try {
        this.loadingButton = true
        const line = await lineService.createLine({
          name: this.name,
          version: this.version.trim(),
          description: this.description.trim(),
          kind: this.kind,
          ...(this.kindDef?.toPayload?.(this.selection) ?? {}),
          parentNamespaceId: this.parentNamespaceId,
          host: this.host ?? undefined,
        })
        try { window.localStorage.setItem(lastKey(this.host), String(this.parentNamespaceId)) } catch { /* nothing is remembered */ }
        // straight to the new line: the list is not what you want to see after creating
        // replace: going back from the new line must not land on the filled-in form again
        await this.$router.replace(line?._id ? `/lines/${line._id}` : '/lines')
      } catch (error) {
        this.error = error.response?.data?.error || error.message
      } finally {
        this.loadingButton = false
      }
    },
  },
}
</script>

<template>
  <div class="form-page-outer form-page-outer--fixed">
    <ProgressOverlay
      :active="loadingButton"
      :title="$t('creation.line_title')"
      :hint="$t('creation.line_hint')"
      :steps="[1, 2, 3, 4, 5].map((n) => $t(`creation.line_step_${n}`))"
      :step-ms="2200"
    />
    <div class="form-page-card app-card form-page-card--shell" :class="{ 'form-page-card--wide': wide }">
      <div class="form-header">
        <div class="form-header__row">
          <PrimeButton
            text rounded size="small"
            class="form-header__back-btn"
            :aria-label="$t('labels.cancel')"
            icon="pi pi-arrow-left"
            @click="$router.go(-1)"
          />
          <div>
            <div class="form-title">{{ $t(kindDef?.title ?? 'labels.spl_add') }}</div>
            <div class="form-subtitle">{{ $t('labels.version') }}: {{ version }}</div>
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

        <form class="form-body__fields" @submit.prevent="onSubmit">
          <Stepper v-model:value="activeStep" class="line-stepper">
            <StepList class="line-stepper__list">
              <template v-for="step in steps" :key="step.key">
                <Step v-if="step.key === 'summary' && !kindDef" :value="PLACEHOLDER_STEP" disabled name="line-step-optional" class="line-stepper__step--optional">{{ $t('creation.step_contents_optional') }}</Step>
                <Step :value="step.value" :disabled="stepLocked(step)" :class="{ 'line-stepper__step--done': step.value < activeStep }" :name="`line-step-${step.key}`">{{ $t(step.title) }}</Step>
              </template>
            </StepList>
            <h3 class="line-stepper__current" name="step-current">{{ $t(steps[activeStep - 1].title) }}</h3>
            <StepPanels class="line-stepper__panels">
              <StepPanel :value="stepNumber('details')">
          <section class="step" name="step-details">
            <div class="step__fields ln-fields">
              <div class="line-field">
                <label for="line-name" class="line-field__label">{{ $t('labels.name') }} <span class="line-field__req" aria-hidden="true">*</span></label>
                <IconField>
                  <InputIcon class="pi pi-tag" />
                  <InputText id="line-name" v-model="name" name="name" required autofocus class="form-field__input" />
                </IconField>
              </div>
              <div class="line-field" name="version-field">
                <label for="line-version" class="line-field__label">{{ $t('creation.version_label') }} <span class="line-field__req" aria-hidden="true">*</span></label>
                <IconField>
                  <InputIcon class="pi pi-hashtag" />
                  <InputText id="line-version" v-model="version" name="version" placeholder="0.1.0" :invalid="Boolean(version.trim()) && !versionValid" class="form-field__input" />
                </IconField>
              </div>
              <div class="line-field step__fields-wide">
                <label for="line-description" class="line-field__label">{{ $t('creation.description_label') }}</label>
                <IconField>
                  <InputIcon class="pi pi-align-left" />
                  <InputText id="line-description" v-model="description" name="description" class="form-field__input" />
                </IconField>
              </div>
            </div>
            <div class="step__where ln-fields">
            <div v-if="hostChoices.length > 1" class="line-field">
            <span class="line-field__label">{{ $t('creation.git_host') }}</span>
            <div class="host-choice" role="radiogroup" :aria-label="$t('creation.git_host')">
              <template v-for="h in hostChoices" :key="h.id">
                <button
                  type="button" role="radio" :aria-checked="host === h.id"
                  class="host-choice__option" :class="{ 'host-choice__option--on': host === h.id }"
                  :name="`host-${h.id}`"
                  @click="chooseHost(h.id)"
                >
                  <GitHostIcon :host="h.id" :size="16" />
                  <span>{{ hostName(h.id) }}</span>
                </button>
              </template>
            </div>
            </div>
            <div class="line-field">
            <label for="line-namespace" class="line-field__label">{{ $t('creation.group_label') }}</label>
            <PrimeSelect
              id="line-namespace"
              v-model="parentNamespaceId"
              :options="namespaceOptions"
              option-value="id"
              option-label="fullPath"
              filter
              auto-filter-focus
              :filter-placeholder="$t('creation.group_search')"
              :placeholder="$t('creation.group_pick')"
              :loading="loadingNamespaces"
              :show-clear="!namespaceRequired"
              :invalid="namespaceRequired && !namespaceChosen && groupTouched"
              panel-class="line-select-panel"
              @hide="groupTouched = true"
              class="form-field__input line-select"
              name="namespace"
            >
              <template #value="{ placeholder }">
                <span class="line-select__value" :class="{ 'line-select__value--empty': !selectedGroup }">
                  <i class="pi pi-folder" aria-hidden="true" />
                  <span>{{ selectedGroup?.fullPath ?? placeholder }}</span>
                </span>
              </template>
              <template #option="{ option }">
                <div class="ns-option">
                  <i class="pi pi-folder" aria-hidden="true" />
                  <span class="ns-option__path">{{ option.fullPath }}</span>
                </div>
              </template>
              <template #empty>
                <div class="ns-option ns-option--empty">{{ $t('labels.gitlab_namespace_empty') }}</div>
              </template>
            </PrimeSelect>
            <small class="line-field__hint">{{ $t(namespaceRequired ? 'labels.gitlab_namespace_required' : 'labels.gitlab_namespace_hint') }}</small>
            </div>
            </div>
          </section>
              </StepPanel>

              <StepPanel :value="stepNumber('type')">
          <section class="step" name="step-type">
            <div class="kind-choice" role="radiogroup" :aria-label="$t('modules.line_kind')">
              <button type="button" role="radio" :aria-checked="kind === 'plain'" class="kind-choice__option" :class="{ 'kind-choice__option--on': kind === 'plain' }" name="kind-plain" @click="kind = 'plain'">
                <span>{{ $t('modules.line_plain') }}</span>
                <small>{{ $t('modules.line_plain_hint') }}</small>
                <KindDiagram kind="plain" class="kind-choice__diagram" />
              </button>
              <button
                v-for="k in extraKinds"
                :key="k.kind"
                type="button" role="radio" :aria-checked="kind === k.kind"
                class="kind-choice__option" :class="{ 'kind-choice__option--on': kind === k.kind }"
                :name="`kind-${k.kind}`"
                @click="kind = k.kind"
              >
                <span>{{ $t(k.label) }}</span>
                <small>{{ $t(k.hint) }}</small>
                <KindDiagram :kind="k.kind" class="kind-choice__diagram" />
              </button>
            </div>
          </section>
              </StepPanel>

              <StepPanel v-if="kindDef" :value="stepNumber('contents')">
          <section class="step" name="step-contents">
            <component
              :is="kindDef.picker"
              :key="kind"
              v-model="selection"
              :name="name || 'new-spl'"
              :fill="true"
              @result="reports = { ...reports, [kind]: $event }"
              @checking="checkingContents = $event"
            />
          </section>
              </StepPanel>

              <StepPanel :value="stepNumber('summary')">
          <section class="step" name="step-summary">
            <div class="step__confirm">
              <CreationSummary :rows="summary" :kind="kind" :items="kindDef ? selection : []" :spl-name="name.trim()" @edit="activeStep = $event" />
            </div>
          </section>
              </StepPanel>
            </StepPanels>
          </Stepper>

          <div class="form-actions">
            <PrimeButton text type="button" :label="$t('labels.cancel')" :style="{ color: 'var(--text-muted)' }" @click="$router.go(-1)" />
            <span class="form-status" :class="`form-status--${status.state}`" name="create-status" role="status" aria-live="polite">
              <i :class="status.icon" aria-hidden="true" />
              <span class="form-status__text">{{ status.text }}</span>
            </span>
            <PrimeButton type="button" outlined :label="$t('creation.step_previous')" name="step-previous" :disabled="activeStep === 1" @click="activeStep -= 1" />
            <PrimeButton v-if="!onLastStep" type="button" :label="$t('creation.step_next')" name="step-next" :disabled="Boolean(missingHere)" @click="nextStep" />
            <PrimeButton v-else type="submit" :label="$t('labels.create')" :loading="loadingButton" :disabled="!canCreate || loadingButton" name="line-create" />
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.line-stepper {
  :deep(.p-steppanels) { padding: 20px 0 0; background: none; }
  :deep(.p-steppanel) { background: none; }
}
.line-stepper__step--done :deep(.p-step-number) { font-size: 0; background: var(--p-primary-color); border-color: var(--p-primary-color); color: var(--p-primary-contrast-color); }
.line-stepper__step--done :deep(.p-step-number)::before { content: '\e909'; font-family: primeicons; font-size: 0.875rem; }
.line-stepper :deep(.p-step-active .p-step-number) { border-color: var(--p-primary-color); color: var(--p-primary-color); box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color) 20%, transparent); }
.line-stepper :deep(.p-step-active .p-step-title) { font-weight: 600; color: var(--text-heading); }
.line-stepper__current { display: none; margin: 16px 0 0; font-size: 14px; font-weight: 600; color: var(--text-heading); }
.step { display: flex; flex-direction: column; gap: 20px; }
.step__hint { margin: 0; font-size: 12px; color: var(--p-text-muted-color); }
.form-status { flex: 1; min-width: 0; height: 36px; font-size: 13px; color: var(--p-text-muted-color); display: inline-flex; gap: 6px; align-items: center; }
.form-status__text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.form-status--ok { color: var(--status-ok); }
.form-status--warning { color: var(--status-warn); }
.form-status--loading { color: var(--p-text-muted-color); }

/* a fixed shell: the card fills the page below the bar, the body scrolls and the footer stays where it is on every step */
.form-page-outer--fixed { box-sizing: border-box; height: calc(100dvh - 56px); min-height: 520px; padding-top: var(--space-4); padding-bottom: var(--space-4); }
.form-page-card--shell { display: flex; flex-direction: column; min-height: 0; }
.form-page-card--shell .form-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.form-page-card--shell .form-body__fields { flex: 1; min-height: 0; }
.line-stepper { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.line-stepper :deep(.p-steppanels) { flex: 1; min-height: 0; overflow-y: auto; }
.line-stepper :deep(.p-steppanel) { height: 100%; }
.line-stepper :deep(.p-steppanel-content), .line-stepper .step { height: 100%; }
/* four columns whatever the kind: the steps keep their place when the kind adds or drops the one of its contents */
.line-stepper__step--optional { opacity: 0.5; }
/* the greyed step has no number to show: a dash instead of its internal value */
.line-stepper__step--optional :deep(.p-step-number) { font-size: 0; }
.line-stepper__step--optional :deep(.p-step-number)::after { content: '–'; font-size: 14px; }
.line-stepper__list { display: grid !important; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.line-stepper__list :deep(.p-step) { min-width: 0; }
/* the fields of the first step: one grid, one rhythm (20px between fields, 8px from a label to its field), one height (40px) */
.step__fields { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 20px; align-items: start; }
.step__fields-wide { grid-column: 1 / -1; }
.step__where { display: flex; flex-direction: column; gap: 20px; }
@media (max-width: 760px) { .step__fields { grid-template-columns: minmax(0, 1fr); } }
.line-field { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.line-field__label { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--p-text-muted-color); }
.line-field__req { color: var(--p-primary-color); }
.line-field__hint { font-size: 12px; line-height: 1.4; color: var(--p-text-muted-color); }
.line-field :deep(input), .line-field :deep(.p-select) { width: 100%; height: 40px; font-size: 14px; box-sizing: border-box; }
.line-field :deep(input:focus), .line-field :deep(.p-select.p-focus) { border-color: var(--p-primary-color); box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color) 22%, transparent); }
.line-field :deep(.p-select-label) { display: flex; align-items: center; padding: 0 12px; font-size: 14px; }
.line-field :deep(.p-select-dropdown) { width: 40px; color: var(--p-text-muted-color); }
.line-select__value { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
.line-select__value > i { color: var(--p-text-muted-color); }
.line-select__value--empty { color: var(--p-text-muted-color); }
.step__confirm { max-width: 760px; margin: 0 auto; width: 100%; }
.step--aside { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 28px; align-items: start; }
.step__main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
@media (max-width: 900px) { .step--aside { grid-template-columns: minmax(0, 1fr); } }
.form-page-card--wide { max-width: 1100px !important; width: 100%; }

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

.form-subtitle {
  font-size: 0.8125rem;
  color: var(--text-muted);
  margin-top: 2px;
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

.kind-choice { margin-block: auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px; }
.kind-choice__diagram { margin-top: auto; padding: 8px; border-radius: 6px; background: var(--p-content-hover-background); box-sizing: border-box; }
@media (max-width: 760px) { .kind-choice { grid-template-columns: minmax(0, 1fr); } }
.kind-choice__option {
  display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 14px; text-align: left; font: inherit;
  color: var(--p-text-color); background: var(--p-content-background); border: 1px solid var(--p-content-border-color); border-radius: 8px; cursor: pointer;
  > span { font-weight: 600; font-size: 15px; }
  small { color: var(--p-text-muted-color); font-size: 0.8rem; line-height: 1.4; }
  &--on { border-color: var(--p-primary-color); background: var(--p-highlight-soft); }
  &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 2px; }
}

.host-choice { display: flex; flex-wrap: wrap; gap: 8px; }
.host-choice__option {
  display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; font: inherit; font-size: 14px;
  color: var(--p-text-color); background: var(--p-content-background); border: 1px solid var(--p-content-border-color); border-radius: 8px; cursor: pointer;
  &--on { border-color: var(--p-primary-color); background: var(--p-highlight-soft); }
  &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 2px; }
}

.modular-choice__label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.modular-choice .form-hint {
  margin-top: 4px;
}

.form-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: -8px;
}

.ns-option {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
}

.ns-option {
  gap: 10px;

  > i { color: var(--text-muted); }
  &__path { font-size: 0.875rem; color: var(--text-heading); overflow-wrap: anywhere; }

  &--empty {
    color: var(--text-muted);
    padding: 8px 12px;
  }
}

.fm-type-group {
  display: flex;
  gap: 8px;
}

.fm-type-btn {
  min-width: 80px;

  &--active {
    background: var(--p-button-primary-background) !important;
    border-color: var(--p-primary-color) !important;
    color: var(--p-primary-contrast-color) !important;
  }
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--p-content-border-color);
  flex-shrink: 0;
}

@media (max-width: 760px) {
  .line-stepper :deep(.p-step-title) { display: none; }
  .line-stepper__current { display: block; }
  .line-stepper :deep(.p-steppanels) { padding-top: 12px; }
  .form-actions { flex-wrap: wrap; }
  .form-status { flex-basis: 100%; order: -1; }
  .line-stepper__list { grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); }
}
</style>

<style>
/* the group list is drawn over the page, out of the scope of the form: the same lighter fields and rows as the rest */
.line-select-panel {
  --p-inputtext-background: var(--p-content-hover-background);
  --p-inputtext-border-color: var(--p-content-border-color);
}
.line-select-panel .p-select-list-container { padding: 4px; }
.line-select-panel .p-select-option { border-radius: 6px; padding: 8px 10px; }
</style>
