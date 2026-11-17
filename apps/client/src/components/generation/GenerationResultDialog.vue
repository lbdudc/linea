<template>
  <component
    :is="frame"
    :visible="visible"
    modal
    :closable="!anyRunning"
    :dismissable-mask="!anyRunning"
    :header="many ? $t('generation.gr_title_many', { n: runs.length }) : $t(`generation.panel_${state}`)"
    class="gr-dialog"
    :style="{ width: many ? '1100px' : '920px', maxWidth: '96vw' }"
    name="generation-result"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="gr-layout" :class="{ 'gr-layout--many': many, 'gr-layout--rail': many && listCollapsed }">
      <aside v-if="many" class="gr-list" :class="{ 'gr-list--rail': listCollapsed }" :aria-label="$t('generation.gp_products')">
        <div class="gr-list__head">
          <p v-if="!listCollapsed" class="gr-list__summary">{{ $t('generation.gr_summary', { done: doneCount, total: runs.length }) }}</p>
          <PrimeButton
            text rounded size="small"
            :icon="listCollapsed ? 'pi pi-angle-double-right' : 'pi pi-angle-double-left'"
            :aria-label="listCollapsed ? $t('generation.gr_list_expand') : $t('generation.gr_list_collapse')"
            :aria-expanded="!listCollapsed"
            v-tooltip.right="listCollapsed ? $t('generation.gr_list_expand') : $t('generation.gr_list_collapse')"
            name="gr-list-toggle"
            @click="toggleList"
          />
        </div>
        <ul>
          <li v-for="item in runs" :key="item.id">
            <button
              type="button"
              class="gr-list__row"
              :class="{ 'gr-list__row--on': current && current.id === item.id }"
              :name="`gr-row-${item.productId}`"
              :title="listCollapsed ? `${item.name} · v${item.toVersion}` : undefined"
              :aria-label="`${item.name} · v${item.toVersion}`"
              @click="focusId = item.id"
            >
              <i :class="rowIcon(item)" :style="{ color: rowColor(item) }" aria-hidden="true" />
              <span v-if="!listCollapsed" class="gr-list__main">
                <span class="gr-list__name">{{ item.name }}</span>
                <span class="gr-list__ver ident">
                  <template v-if="item.status === 'pending'">≈ </template>v{{ item.toVersion }}
                </span>
              </span>
            </button>
          </li>
        </ul>
      </aside>

      <div v-if="current" ref="body" class="gr">
        <header class="gr__head" :class="`gr__head--${state}`">
          <i :class="icon" aria-hidden="true" />
          <div class="gr__head-text">
            <span v-if="many" class="gr__name">{{ current.name }}</span>
            <span class="gr__versions ident">
              <template v-if="baseVersion && baseVersion !== current.toVersion">v{{ baseVersion }} <i class="pi pi-arrow-right" aria-hidden="true" /> </template>
              <strong>v{{ current.toVersion }}</strong>
              <span v-if="queued" class="gr__estimated" v-tooltip.bottom="$t('generation.gr_estimated_hint')">{{ $t('generation.gr_estimated') }}</span>
            </span>
            <span class="gr__head-sub">{{ queued ? $t('generation.gr_sub_queued') : $t(`generation.gr_sub_${state}`) }}</span>
          </div>
        </header>

        <ProgressBar v-if="running && !queued" mode="indeterminate" :show-value="false" style="height: 3px" />

        <!-- what the version changes in the specification: a fact about the version, not a step of generating it -->
        <section v-if="specBlock" class="gr__spec" :class="{ 'gr__spec--link': specBlock.canOpen }" name="gr-spec-block">
          <i class="pi pi-sitemap gr__spec-icon" aria-hidden="true" />
          <div class="gr__spec-text">
            <span class="gr__spec-title">{{ $t('generation.gr_spec_title') }}</span>
            <span v-if="specBlock.message" class="gr__spec-sub">{{ specBlock.message }}</span>
            <span v-else class="gr__spec-chips" name="gr-changes-summary">
              <span v-for="chip in changeChips" :key="chip.key" class="gr__chip">
                <i :class="chip.icon" aria-hidden="true" /> {{ chip.label }}
              </span>
            </span>
          </div>
          <PrimeButton
            v-if="specBlock.canOpen"
            text size="small"
            :label="$t('generation.gr_see_changes')"
            name="gr-open-changes"
            @click="showChanges = true"
          >
            <template #icon><i class="pi pi-arrow-right" style="font-size: 12px" aria-hidden="true" /></template>
          </PrimeButton>
        </section>

        <p v-if="queued" class="gr__note" name="gr-queued">
          <i class="pi pi-clock" aria-hidden="true" /> {{ $t('generation.gr_sub_queued') }}
          <span v-if="current.queue" name="gr-queue-position">· {{ $t('generation.gr_queue_position', { n: current.queue.position, total: current.queue.waiting, time: durationText(current.queue.estimateMs) }) }}</span>
        </p>
        <p v-else-if="cancelled" class="gr__note" name="gr-cancelled"><i class="pi pi-ban" aria-hidden="true" /> {{ current.startedAt ? $t('generation.gr_cancelled_running') : $t('generation.gr_cancelled') }}</p>

        <Stepper v-else v-model:value="activeStep" class="gr__stepper">
          <StepList>
            <Step v-for="s in steps" :key="s.key" :value="s.key" as-child v-slot="{ activateCallback, active }">
              <button
                type="button"
                class="gr__step-btn"
                :class="[`gr__step-btn--${s.state}`, { 'gr__step-btn--sel': active }]"
                :name="`gr-step-${s.key}`"
                @click="activateCallback"
              >
                <span class="gr__step-btn-dot"><i :class="stepIcon(s.state)" aria-hidden="true" /></span>
                <span class="gr__step-btn-label">{{ s.label }}</span>
              </button>
            </Step>
          </StepList>
          <StepPanels>
            <StepPanel :value="steps[0].key">
              <div class="gr__stage-body">
                <Message v-if="failureStage === 'generate'" severity="error" :closable="false" name="gr-failed" :class="{ gr__located: failureLocated('generate') }"><span>{{ failureMessage }}</span><details v-if="failureDetail" class="gr__failure-detail" name="gr-failure-detail"><summary>{{ $t('generation.gr_failure_detail') }}</summary><pre>{{ failureDetail }}</pre><PrimeButton :label="$t('generation.gr_failure_copy')" icon="pi pi-copy" size="small" severity="secondary" text name="gr-failure-copy" @click="copyFailure" /></details></Message>
                <GenerationFlow v-if="showFlow" :messages="generateMessages" :status="flowStatus" :selected="selectedIn('generate')" @locate="locate('generate', $event)" />
                <p v-if="running && !generateMessages.length" class="gr__state">
                  <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ $t('generation.starting') }}
                </p>
                <StepSection
                  v-if="generateMessages.length"
                  :label="$t('generation.log_steps', { n: generateMessages.length })"
                  :open="sectionOpen('generate')"
                  name="gr-log"
                  @update:open="setSection('generate', $event)"
                >
                  <div ref="log" class="gr__log" name="gr-log">
                    <LogItem v-for="(log, index) in generateMessages" :key="index" :log="log" :class="{ 'gr__located-log': locatedLogs.has(log) }" />
                  </div>
                </StepSection>
              </div>
            </StepPanel>

            <StepPanel :value="steps[1].key">
              <div class="gr__stage-body">
                <Message v-if="failureStage === 'deploy'" severity="error" :closable="false" name="gr-deploy-failed" :class="{ gr__located: failureLocated('deploy') }"><span>{{ failureMessage }}</span><details v-if="failureDetail" class="gr__failure-detail"><summary>{{ $t('generation.gr_failure_detail') }}</summary><pre>{{ failureDetail }}</pre><PrimeButton :label="$t('generation.gr_failure_copy')" icon="pi pi-copy" size="small" severity="secondary" text @click="copyFailure" /></details></Message>
                <CommitFlow v-if="commitBegun" :messages="messages" :status="flowStatus" :selected="selectedIn('deploy')" @locate="locate('deploy', $event)" />
                <StepSection
                  v-if="deployMessages.length"
                  :label="$t('generation.log_steps', { n: deployMessages.length })"
                  :open="sectionOpen('deploy')"
                  name="gr-deploy-log"
                  @update:open="setSection('deploy', $event)"
                >
                  <div class="gr__log" name="gr-deploy-log">
                    <LogItem v-for="(log, index) in deployMessages" :key="index" :log="log" :class="{ 'gr__located-log': locatedLogs.has(log) }" />
                  </div>
                </StepSection>
                <Message v-if="current.result?.conflicts" severity="warn" :closable="false" name="gr-conflicts" :class="{ gr__located: ['merge', 'release'].includes(selectedIn('deploy')) }">{{ $t('generation.conflicts') }}</Message>
                <p v-if="unchanged" class="gr__state" name="gr-uptodate">{{ $t('generation.up_to_date') }}</p>
                <MergeRequestChecks
                  v-if="showChecks" :key="current.id" :product-id="current.productId" :number="current.checksRequest ?? null"
                  :decidable="awaitingDecision" :class="{ gr__located: ['checks', 'release'].includes(selectedIn('deploy')) }" @decided="onDecided"
                />
                <a
                  v-if="current.historic && current.link"
                  class="gr__pipeline-link"
                  :href="current.link"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ $t('labels.open_in_gitlab') }}</a>
                <template v-if="succeeded && !unchanged && deployable && (!current.historic || pipeline) && !showChecks && view.decision !== 'reject'">
                  <div class="gr__pipeline" :class="[`gr__pipeline--${pipelineTone}`, { gr__located: selectedIn('deploy') === 'release' }]" name="gr-pipeline">
                    <i :class="pipelineIcon" aria-hidden="true" />
                    <div class="gr__pipeline-text">
                      <span class="gr__pipeline-title">{{ $t('generation.gr_pipeline') }}</span>
                      <span class="gr__pipeline-status" name="gr-pipeline-status">{{ pipelineLabel }}</span>
                    </div>
                    <a
                      v-if="pipeline?.webUrl"
                      class="gr__pipeline-link"
                      :href="pipeline.webUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                    >{{ $t('labels.open_in_gitlab') }}</a>
                  </div>
                  <StepSection
                    v-if="jobs.length"
                    :label="$t('generation.log_steps', { n: jobs.length })"
                    :open="sectionOpen('jobs')"
                    name="gr-jobs"
                    @update:open="setSection('jobs', $event)"
                  >
                    <PipelineJobs :key="pipeline?.id" :product-id="current.productId" :jobs="jobs" :live="!pipelineGaveUp" />
                  </StepSection>
                  <div v-if="pipelineFailed && !view.decision" class="gr__failed" name="gr-pipeline-failed">
                    <p class="gr__failed-title">
                      <i class="pi pi-times-circle" aria-hidden="true" />
                      {{ failedJob ? $t('generation.gr_job_failed_named', { name: failedJob.name }) : $t('generation.gr_pipeline_failed') }}
                    </p>
                    <div class="gr__failed-actions">
                      <PrimeButton
                        v-if="!current.historic"
                        size="small"
                        :label="$t('generation.gr_pipeline_retry')"
                        :loading="retrying"
                        name="gr-pipeline-retry"
                        @click="retryPipeline"
                      >
                        <template #icon><i class="pi pi-refresh" style="font-size: 12px" aria-hidden="true" /></template>
                      </PrimeButton>
                      <span v-if="canRollback" class="gr__failed-hint">{{ $t('generation.gr_failed_hint', { version: baseVersion }) }}</span>
                    </div>
                  </div>
                  <p v-if="pipelineGaveUp" class="gr__state" name="gr-pipeline-gave-up">{{ pipeline ? $t('generation.gr_pipeline_stale') : $t('generation.gr_pipeline_none') }}</p>
                </template>
              </div>
            </StepPanel>
          </StepPanels>
        </Stepper>
      </div>
    </div>

    <PrimeDialog
      v-if="current"
      :visible="showChanges"
      modal
      :header="$t('generation.gr_spec_title')"
      class="gr-changes-dialog"
      :style="{ width: '720px', maxWidth: '94vw' }"
      name="generation-changes"
      @update:visible="showChanges = $event"
    >
      <p v-if="changes.loading" class="gr__state"><i class="pi pi-spin pi-spinner" aria-hidden="true" /></p>
      <p v-else-if="changes.error" class="gr__state" name="gr-changes-error">{{ changes.error }}</p>
      <p v-else-if="changes.first" class="gr__state">{{ $t('generation.gp_first_generation') }}</p>
      <SpecChangesView
        v-else-if="changes.after"
        readonly
        :deployed="changes.before"
        :saved="changes.after"
        :models="changes.models"
        :version="current.toVersion"
        :from-label="baseVersion ? `v${baseVersion}` : ''"
        :to-label="`v${current.toVersion}`"
      />
    </PrimeDialog>

    <template #footer>
      <PrimeButton size="small"
        v-if="anyRunning"
        text
        :label="$t('generation.gr_minimize')"
        name="gr-minimize"
        @click="$emit('minimize')"
      >
        <template #icon><i class="pi pi-window-minimize" style="font-size: 12px" aria-hidden="true" /></template>
      </PrimeButton>

      <PrimeButton size="small"
        v-if="queued"
        text
        :label="$t('generation.gr_cancel_queued')"
        name="gr-cancel-queued"
        @click="$emit('cancel', current.id)"
      >
        <template #icon><i class="pi pi-ban" style="font-size: 12px" aria-hidden="true" /></template>
      </PrimeButton>

      <span v-if="running && !queued && current.cancelRefused" class="gr__confirm" name="gr-cancel-too-late">{{ $t('generation.gr_cancel_too_late') }}</span>
      <PrimeButton size="small"
        v-if="running && !queued && !embedded"
        text severity="danger"
        :disabled="Boolean(current.cancelling)"
        :label="current.cancelling ? $t('generation.gr_cancelling') : $t('generation.gr_cancel_running')"
        name="gr-cancel-running"
        @click="$emit('cancel', current.id)"
      >
        <template #icon><i class="pi pi-ban" style="font-size: 12px" aria-hidden="true" /></template>
      </PrimeButton>


      <template v-if="current && !running">
        <span v-if="confirmingRollback" class="gr__confirm">{{ $t('generation.gr_rollback_confirm', { version: baseVersion, next: rollbackNext }) }}</span>
        <PrimeButton size="small"
          v-if="confirmingRollback"
          text
          :label="$t('labels.cancel')"
          name="gr-rollback-cancel"
          @click="confirmingRollback = false"
        />
        <PrimeButton size="small"
          v-if="confirmingRollback"
          severity="danger"
          :label="$t('generation.gr_rollback_yes', { version: baseVersion, next: rollbackNext })"
          name="gr-rollback-confirm"
          @click="rollback"
        />

        <template v-else>
          <PrimeButton size="small"
            v-if="canRollback"
            :text="!pipelineFailed" severity="danger"
            :label="$t('generation.gr_rollback', { version: baseVersion })"
            name="gr-rollback"
            @click="confirmingRollback = true"
          >
            <template #icon><i class="pi pi-undo" style="font-size: 12px" aria-hidden="true" /></template>
          </PrimeButton>
          <PrimeButton size="small"
            v-if="succeeded && deployable && !unchanged && !awaitingDecision && view.decision !== 'reject'"
            text
            :label="$t('generation.gr_download')"
            :loading="downloading"
            name="gr-download"
            @click="download"
          >
            <template #icon><i class="pi pi-download" style="font-size: 12px" aria-hidden="true" /></template>
          </PrimeButton>
          <PrimeButton size="small"
            v-if="!succeeded && messages.length"
            text
            :label="$t('generation.log_download')"
            name="gr-log-download"
            @click="downloadLog"
          >
            <template #icon><i class="pi pi-download" style="font-size: 12px" aria-hidden="true" /></template>
          </PrimeButton>
          <PrimeButton size="small"
            v-if="!succeeded && ['error', 'cancelled'].includes(current.status) && messages.length"
            text
            :label="$t('generation.bundle_download')"
            :loading="bundling"
            name="gr-bundle-download"
            @click="downloadBundle"
          >
            <template #icon><i class="pi pi-box" style="font-size: 12px" aria-hidden="true" /></template>
          </PrimeButton>
          <PrimeButton size="small"
            v-if="!succeeded && !current.historic"
            text
            :label="cancelled ? $t('generation.gr_requeue') : $t('generation.gr_retry')"
            name="gr-retry"
            @click="$emit('retry', current.productId)"
          >
            <template #icon><i class="pi pi-refresh" style="font-size: 12px" aria-hidden="true" /></template>
          </PrimeButton>
          <PrimeButton size="small" v-if="!anyRunning && !embedded" :label="$t('labels.close')" name="gr-close" @click="$emit('update:visible', false)" />
        </template>
      </template>
    </template>
  </component>
</template>

<script>
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import Message from 'primevue/message';
import Tooltip from 'primevue/tooltip';
import ProgressBar from 'primevue/progressbar';
import Stepper from 'primevue/stepper';
import StepList from 'primevue/steplist';
import Step from 'primevue/step';
import StepPanels from 'primevue/steppanels';
import StepPanel from 'primevue/steppanel';
import LogItem from '../common/LogItem.vue';
import SpecChangesView from './SpecChangesView.vue';
import GenerationFlow from './GenerationFlow.vue';
import CommitFlow from './CommitFlow.vue';
import StepSection from './StepSection.vue';
import EmbeddedFrame from './EmbeddedFrame.vue';
import { hasFlow, logOfFlowNode } from 'src/utils/generationFlow';
import { commitStarted, logOfStep, stagesOf } from 'src/utils/commitFlow';
import productService from 'src/services/productService';
import { diffSpecs } from 'src/utils/specDiff';
import { bumpVersion } from 'src/utils/bumpVersion';
import PipelineJobs from 'src/components/product/PipelineJobs.vue';
import MergeRequestChecks from 'src/components/product/MergeRequestChecks.vue';
import { PIPELINE_FINAL, pipelineWord } from 'src/utils/pipelineStatus';
import { downloadBlob } from 'src/utils/download';
import { formatDuration, logToText } from 'src/utils/generationLog';

const RUNNING = ['pending', 'running'];
const POLL_MS = 4000;
const SLOW_POLL_MS = 30 * 1000;
const GIVE_UP_MS = 3 * 60 * 1000;
const STOP_FOLLOWING_MS = 60 * 60 * 1000;

const emptyChanges = () => ({
  loading: false, error: '', before: null, after: null, models: null, first: false, hasPrevious: false, previousVersion: '',
});
const emptyView = () => ({
  showChanges: false, changes: emptyChanges(), pipeline: null, jobs: [], failed: null, retrying: false, gaveUp: false,
  watching: false, watchedAt: 0,
});
const FINISHED = ['success', 'warning'];

// the list of a batch stays as the person left it, like the explorer of the app
const COLLAPSE_KEY = 'linea.generation.listCollapsed';
const readCollapsed = () => {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
};

// The whole of a generation in one place: the version it makes, what it did (the log), what changed in the specification
// against the version before, and how its deployment goes (the pipeline of the commit), with the ways back.
// It takes one run (a product page) or many (the selection of a line): then the list of them sits on the left.
export default {
  name: 'GenerationResultDialog',
  components: {
    PrimeDialog: Dialog, PrimeButton: Button, Message, ProgressBar, Stepper, StepList, Step, StepPanels, StepPanel, LogItem, SpecChangesView, PipelineJobs, MergeRequestChecks, GenerationFlow, CommitFlow, StepSection,
  },
  directives: { tooltip: Tooltip },
  props: {
    visible: { type: Boolean, required: true },
    // [{ id, productId, name, fromVersion ('' for the first one or when it is not known), toVersion, historic (it is not the one that just ran), checksRequest (the merge request whose checks it tells), link, status: 'pending' | 'running' | 'success' | 'warning' | 'error',
    //    messages, result: { changed, conflicts } | null, deployable (it has a repository whose pipeline can be followed), startedAt }]
    runs: { type: Array, required: true },
    // told in the place of a page, not in a window over it
    embedded: { type: Boolean, default: false },
  },
  emits: ['update:visible', 'minimize', 'rollback', 'retry', 'cancel', 'error', 'decided'],
  data() {
    return { focusId: null, views: {}, confirmingRollback: false, downloading: false, bundling: false, timer: null, polling: false, pollLoop: 0, listCollapsed: readCollapsed() };
  },
  computed: {
    frame() {
      return this.embedded ? EmbeddedFrame : Dialog;
    },
    many() {
      return this.runs.length > 1;
    },
    current() {
      return this.runs.find((r) => r.id === this.focusId)
        ?? this.runs.find((r) => RUNNING.includes(r.status))
        ?? this.runs[0] ?? null;
    },
    view() {
      return (this.current && this.views[this.current.id]) || emptyView();
    },
    showChanges: {
      get() { return this.view.showChanges ?? false; },
      set(value) { if (this.current) this.patchView(this.current.id, { showChanges: value }); },
    },
    changes() { return this.view.changes; },
    // the one that was followed, or the one a past version had when it is opened from the history
    pipeline() { return this.view.pipeline ?? this.current?.pipeline ?? null; },
    // the block about the specification: only for a version that was made, and what it says depends on what was read
    specBlock() {
      const run = this.current;
      if (!run || this.running || !this.succeeded || this.unchanged) return null;
      if (this.awaitingDecision || this.view.decision === 'reject') return null;
      const c = this.changes;
      if (c.loading) return { message: this.$t('generation.gr_spec_loading'), canOpen: false };
      if (c.error) return { message: c.error, canOpen: false };
      if (c.first) return { message: this.$t('generation.gp_first_generation'), canOpen: Boolean(c.after) };
      if (!c.after) return null;
      return this.changeChips.length
        ? { message: '', canOpen: true }
        : { message: this.$t('generation.diff_none'), canOpen: false };
    },
    jobs() { return this.view.jobs; },
    // the checks of the merge request are followed from the moment LINEA starts waiting for them, and until they have been decided on
    showChecks() {
      const run = this.current;
      if (run?.checksRequest) return true;
      return Boolean(run) && !run.historic && (this.running || this.awaitingDecision) && this.messages.some((m) => m.message === 'log.waiting_checks');
    },
    awaitingDecision() {
      return !this.running && Boolean(this.current?.result?.checksFailed) && !this.view.decision;
    },
    failedJob() { return this.view.failed; },
    retrying() { return this.view.retrying; },
    pipelineFailed() { return ['failed', 'canceled'].includes(this.pipeline?.status); },
    cancelled() { return this.current?.status === 'cancelled'; },
    // the version the going back makes: what is generated next from this one
    rollbackNext() { return bumpVersion(this.current?.toVersion, 'patch'); },
    pipelineGaveUp() { return this.view.gaveUp; },
    anyRunning() {
      return this.runs.some((r) => RUNNING.includes(r.status));
    },
    doneCount() {
      return this.runs.filter((r) => !RUNNING.includes(r.status)).length;
    },
    // what the log says, and what a decision answered if the log has not told it (the runs of a batch only hear while they run)
    messages() {
      const told = this.current?.messages ?? [];
      const decided = this.view.decisionLog;
      return decided && !told.some((m) => m.message === decided.message && m.version === decided.version) ? [...told, decided] : told;
    },
    messageStages() {
      return stagesOf(this.messages);
    },
    generateMessages() {
      return this.messages.filter((m, index) => this.messageStages[index] === 'generate');
    },
    deployMessages() {
      return this.messages.filter((m, index) => this.messageStages[index] === 'deploy');
    },
    locatedLogs() {
      const located = this.view.located;
      if (!located) return new Set();
      return new Set(located.stage === 'generate'
        ? logOfFlowNode(this.generateMessages, this.flowStatus, located.key)
        : logOfStep(this.messages, this.flowStatus, located.key));
    },
    commitBegun() {
      return commitStarted(this.messages);
    },
    failureStage() {
      if (this.running || this.succeeded) return null;
      return this.commitBegun ? 'deploy' : 'generate';
    },
    showFlow() {
      return this.running || hasFlow(this.generateMessages);
    },
    flowStatus() {
      if (this.running) return 'running';
      return this.succeeded ? 'done' : 'failed';
    },
    running() {
      return Boolean(this.current) && RUNNING.includes(this.current.status);
    },
    queued() {
      return this.current?.status === 'pending';
    },
    state() {
      if (this.running) return 'running';
      if (this.awaitingDecision) return 'waiting';
      if (this.view.decision === 'merge') return 'success';
      if (this.view.decision === 'reject') return 'rejected';
      const status = this.current?.status;
      return ['error', 'warning', 'cancelled'].includes(status) ? status : 'success';
    },
    succeeded() {
      return !this.running && FINISHED.includes(this.current?.status);
    },
    icon() {
      return {
        running: 'pi pi-cog pi-spin', success: 'pi pi-check-circle', warning: 'pi pi-exclamation-triangle', error: 'pi pi-times-circle',
        cancelled: 'pi pi-ban', waiting: 'pi pi-exclamation-triangle', rejected: 'pi pi-ban',
      }[this.state];
    },
    unchanged() {
      return this.current?.result?.changed === false;
    },
    deployable() {
      return this.current?.deployable !== false;
    },
    // the version this one came from: the one the run says, or the one the server found when it read the changes
    baseVersion() {
      return this.current?.fromVersion || this.changes.previousVersion || '';
    },
    // going back makes sense when this generation made a new version over another one
    canRollback() {
      const run = this.current;
      return this.succeeded && !this.unchanged && Boolean(this.baseVersion) && this.baseVersion !== run.toVersion
        && this.changes.hasPrevious;
    },
    steps() {
      const generating = this.commitBegun || this.succeeded ? 'done' : (this.running ? (this.queued ? 'pending' : 'active') : 'failed');
      let deploy = 'pending';
      if (this.view.decision === 'reject') deploy = 'skipped';
      else if (this.view.decision === 'merge') deploy = 'done';
      else if (this.awaitingDecision) deploy = 'waiting';
      else if (this.running) deploy = this.commitBegun ? 'active' : 'pending';
      else if (this.failureStage === 'deploy') deploy = 'failed';
      else if (this.succeeded && this.unchanged) deploy = 'skipped';
      else if (this.succeeded && this.deployable && (!this.current?.historic || this.pipeline)) {
        const status = this.pipeline?.status;
        if (['failed', 'canceled'].includes(status)) deploy = 'failed';
        else deploy = ['success', 'skipped', 'manual'].includes(status) || this.pipelineGaveUp ? 'done' : 'active';
      } else if (this.succeeded) {
        deploy = 'done';
      }
      return [
        { key: 'generate', label: this.$t('generation.gr_step_generate'), state: generating },
        { key: 'deploy', label: this.$t('generation.gr_step_deploy'), state: deploy },
      ];
    },
    // the furthest step the run has reached, while nobody has clicked another one
    autoStep() {
      const reached = this.steps.filter((s) => s.state !== 'pending');
      return (reached[reached.length - 1] ?? this.steps[0]).key;
    },
    activeStep: {
      get() { return this.view.activeStep ?? this.autoStep; },
      set(value) { if (this.current) this.patchView(this.current.id, { activeStep: value }); },
    },
    // what changed, by kind, for the summary: the same split the changes view makes
    changeChips() {
      const { before, after, models } = this.changes;
      if (!before || !after) return [];
      const found = diffSpecs(before, after);
      const features = found.filter((c) => c.path === 'features');
      const fields = found.filter((c) => c.path !== 'features' && c.path !== 'basicData.version');
      const chips = [];
      if (features.length) {
        const added = features.filter((c) => c.kind === 'added').length;
        chips.push({ key: 'features', icon: 'pi pi-sitemap', label: this.$t('generation.gr_chip_features', { added, removed: features.length - added }) });
      }
      if (fields.length) chips.push({ key: 'fields', icon: 'pi pi-sliders-h', label: this.$t('generation.gr_chip_fields', { n: fields.length }) });
      const names = models?.deployed && models?.saved
        ? [...new Set([...Object.keys(models.deployed), ...Object.keys(models.saved)])]
          .filter((name) => (models.deployed[name] ?? '') !== (models.saved[name] ?? ''))
        : [];
      if (names.length) chips.push({ key: 'models', icon: 'pi pi-file', label: this.$t('generation.gr_chip_models', { n: names.length }) });
      return chips;
    },
    // the last thing the log said went wrong
    failureMessage() {
      const last = [...this.messages].reverse().find((m) => m.type === 'error');
      return last ? this.$t(last.message, last.params) : this.$t('generation.gr_sub_error');
    },
    // what the log said about why (the message of the template that threw, a conflicting file...), when it said it
    failureDetail() {
      const last = [...this.messages].reverse().find((m) => m.type === 'error');
      return last?.detail ? String(last.detail) : '';
    },
    pipelineTone() {
      const status = this.pipeline?.status;
      if (status === 'success') return 'ok';
      if (['failed', 'canceled'].includes(status)) return 'bad';
      if (status === 'manual' || this.pipelineGaveUp) return 'idle';
      return status ? 'run' : 'idle';
    },
    pipelineIcon() {
      return { ok: 'pi pi-check-circle', bad: 'pi pi-times-circle', run: 'pi pi-spin pi-spinner', idle: 'pi pi-clock' }[this.pipelineTone];
    },
    pipelineLabel() {
      const status = this.pipeline?.status;
      if (!status) return this.pipelineGaveUp ? this.$t('generation.gr_pipeline_unknown') : this.$t('generation.gr_pipeline_waiting');
      return this.$t(`generation.gr_pipeline_${pipelineWord(status)}`);
    },
  },
  watch: {
    // a run that ends, or a new one that comes in, is looked at
    runs() {
      this.sync();
    },
    'current.status'() {
      this.sync();
    },
    'current.id'() {
      this.confirmingRollback = false;
    },
    visible(open) {
      if (open) this.sync();
      else this.stopPolling();
    },
    'messages.length'() {
      this.scrollLog();
    },
  },
  mounted() {
    this.sync();
  },
  beforeUnmount() {
    this.stopPolling();
  },
  methods: {
    copyFailure() {
      const text = [this.failureMessage, this.failureDetail].filter(Boolean).join('\n');
      return navigator.clipboard?.writeText(text);
    },
    patchView(id, patch) {
      this.views = { ...this.views, [id]: { ...(this.views[id] ?? emptyView()), ...patch } };
    },

    // the drawings already tell how a stage goes, so its log stays closed unless it failed there; what a person chose stays
    sectionOpen(key) {
      const chosen = this.view.sections?.[key];
      if (chosen !== undefined) return chosen;
      if (key === 'jobs') return true;
      return this.failureStage === key;
    },
    setSection(key, open) {
      if (!this.current) return;
      this.patchView(this.current.id, { sections: { ...this.view.sections, [key]: open } });
      if (key === 'generate' && open) this.scrollLog();
    },
    selectedIn(stage) {
      const located = this.view.located;
      return located?.stage === stage ? located.key : null;
    },
    failureLocated(stage) {
      return this.selectedIn(stage) !== null && [...this.locatedLogs].some((log) => log.type === 'error');
    },
    locate(stage, key) {
      if (!this.current) return;
      if (this.selectedIn(stage) === key) {
        this.patchView(this.current.id, { located: null });
        return;
      }
      this.patchView(this.current.id, { located: { stage, key }, sections: { ...this.view.sections, [stage]: true } });
      this.$nextTick(() => {
        const body = this.$refs.body;
        body?.querySelector('.gr__located-log')?.scrollIntoView?.({ block: 'nearest' });
        body?.querySelector('.gr__located, .gr__located-log')?.scrollIntoView?.({ block: 'nearest' });
      });
    },
    onDecided(answer) {
      const run = this.current;
      if (!run) return;
      this.patchView(run.id, { decisionLog: answer.log, ...(answer.conflicts ? {} : { decision: answer.decision }) });
      if (answer.decision === 'merge' && !answer.conflicts) this.loadChanges(run);
      this.$emit('decided', { runId: run.id, productId: run.productId, ...answer });
    },
    scrollLog() {
      if (this.selectedIn('generate')) return;
      this.$nextTick(() => {
        const el = this.$refs.log;
        if (el) el.scrollTop = el.scrollHeight;
      });
    },

    // every run that finished gets its changes read and its pipeline followed, once
    sync() {
      for (const run of this.runs) {
        const view = this.views[run.id];
        const decided = run.decision ?? run.result?.checksDecision;
        if (!view || (decided && !view.decision)) this.patchView(run.id, decided ? { decision: decided } : {});
        if (RUNNING.includes(run.status) || view?.watching) continue;
        const ok = FINISHED.includes(run.status);
        this.patchView(run.id, { watching: true, watchedAt: Date.now() });
        if (ok && run.result?.changed !== false) this.loadChanges(run);
        // a past version is not followed: its jobs are read once
        if (run.historic && run.pipeline?.id !== undefined) this.loadPastJobs(run);
      }
      if (this.visible && this.runs.some((r) => this.needsPolling(r))) this.startPolling();
      else this.stopPolling();
    },
    needsPolling(run) {
      const view = this.views[run.id];
      return Boolean(view?.watching) && !run.historic && FINISHED.includes(run.status) && run.result?.changed !== false && run.deployable !== false
        && !view.gaveUp && !(view.pipeline && PIPELINE_FINAL.includes(view.pipeline.status));
    },

    stepIcon(state) {
      return {
        pending: 'pi pi-circle', active: 'pi pi-spin pi-spinner', done: 'pi pi-check-circle', failed: 'pi pi-times-circle', skipped: 'pi pi-minus-circle', waiting: 'pi pi-exclamation-circle',
      }[state];
    },
    rowIcon(run) {
      if (run.status === 'pending') return 'pi pi-clock';
      if (run.status === 'running') return 'pi pi-spin pi-spinner';
      return { cancelled: 'pi pi-ban', success: 'pi pi-check-circle', warning: 'pi pi-exclamation-triangle', error: 'pi pi-times-circle' }[run.status];
    },
    rowColor(run) {
      return {
        success: 'var(--status-ok)', warning: 'var(--status-warn)', error: 'var(--status-bad)', running: 'var(--p-primary-color)',
        cancelled: 'var(--text-muted)',
      }[run.status] ?? 'var(--text-muted)';
    },

    async loadPastJobs(run) {
      try {
        const answer = await productService.getPipelineById({ id: run.productId, pipelineId: run.pipeline.id });
        this.patchView(run.id, { pipeline: run.pipeline, jobs: answer.jobs ?? [], failed: answer.failed ?? null });
      } catch (e) {
        this.patchView(run.id, { pipeline: run.pipeline });
      }
    },

    // the version that was made against the one before it
    async loadChanges(run) {
      this.patchView(run.id, { changes: { ...emptyChanges(), loading: true } });
      try {
        const snapshot = await productService.getVersion({
          id: run.productId, version: run.toVersion, previous: run.fromVersion || undefined,
        });
        const previous = snapshot.previous;
        const changes = (!previous && !run.fromVersion)
          ? { ...emptyChanges(), after: snapshot.spec, first: true }
          : {
            ...emptyChanges(),
            before: previous?.spec ?? { basicData: {}, features: [] },
            after: snapshot.spec,
            models: snapshot.models ? { deployed: previous?.models ?? {}, saved: snapshot.models } : null,
            hasPrevious: Boolean(previous),
            previousVersion: previous?.version ?? '',
          };
        this.patchView(run.id, { changes });
      } catch (error) {
        const code = error.response?.data?.error;
        this.patchView(run.id, {
          changes: { ...emptyChanges(), error: code ? this.$t(code) : this.$t('error_messages.internal_error') },
        });
      }
    },

    // the pipeline of the commit a generation pushed: the last one that is not older than the generation itself
    startPolling() {
      if (this.polling) return;
      this.polling = true;
      this.pollLoop += 1;
      this.pollAll(this.pollLoop);
    },
    stopPolling() {
      this.polling = false;
      clearTimeout(this.timer);
      this.timer = null;
    },
    async pollAll(loop) {
      await Promise.all(this.runs.filter((r) => this.needsPolling(r)).map((r) => this.pollOne(r)));
      if (!this.polling || loop !== this.pollLoop) return;
      const waiting = this.runs.filter((r) => this.needsPolling(r));
      if (!waiting.length) {
        this.stopPolling();
        return;
      }
      const youngest = Math.max(...waiting.map((r) => this.views[r.id].watchedAt));
      this.timer = setTimeout(() => this.pollAll(loop), Date.now() - youngest < GIVE_UP_MS ? POLL_MS : SLOW_POLL_MS);
    },
    async pollOne(run) {
      // a run that does not say when it began (the last deployment of a product, opened from the list) takes the pipeline there is
      const since = run.startedAt ? new Date(run.startedAt).getTime() : 0;
      try {
        const answer = await productService.getPipeline({ id: run.productId });
        const last = answer?.pipeline;
        // a minute of margin: the clocks of the server and the git host are not the same
        if (last && new Date(last.createdAt).getTime() >= since - 60000) {
          this.patchView(run.id, { pipeline: last, jobs: answer.jobs ?? [], failed: answer.failed ?? null });
        }
      } catch (e) {
        // the next tick tries again
      }
      const view = this.views[run.id];
      if (Date.now() - view.watchedAt > (view.pipeline ? STOP_FOLLOWING_MS : GIVE_UP_MS)) this.patchView(run.id, { gaveUp: true });
    },

    toggleList() {
      this.listCollapsed = !this.listCollapsed;
      try { localStorage.setItem(COLLAPSE_KEY, this.listCollapsed ? '1' : '0'); } catch { /* it is only a preference */ }
    },
    jobTone(status) {
      if (status === 'success') return 'success';
      if (status === 'failed') return 'failed';
      if (status === 'running') return 'running';
      if (['skipped', 'canceled'].includes(status)) return 'skipped';
      return 'pending';
    },
    jobIcon(status) {
      return {
        success: 'pi pi-check-circle', failed: 'pi pi-times-circle', running: 'pi pi-spin pi-spinner', skipped: 'pi pi-minus-circle', pending: 'pi pi-circle',
      }[this.jobTone(status)];
    },

    // runs the failed jobs again and goes back to following it
    async retryPipeline() {
      const run = this.current;
      if (!run || this.retrying) return;
      this.patchView(run.id, { retrying: true });
      try {
        const answer = await productService.retryPipeline({ id: run.productId });
        this.patchView(run.id, {
          retrying: false, gaveUp: false,
          pipeline: answer.pipeline ? { ...answer.pipeline, status: 'running' } : this.views[run.id].pipeline,
          jobs: answer.jobs ?? [], failed: null, watchedAt: Date.now(),
        });
        this.startPolling();
      } catch (error) {
        this.patchView(run.id, { retrying: false });
        this.$emit('error', error.response?.data?.error || 'error_messages.internal_error');
      }
    },

    rollback() {
      this.confirmingRollback = false;
      this.$emit('rollback', { productId: this.current.productId, version: this.baseVersion });
    },

    durationText(ms) {
      return formatDuration(ms);
    },

    downloadLog() {
      const run = this.current;
      const text = logToText({ logs: this.messages, translate: (key, params) => this.$t(key, params), title: `${run.name ?? run.productName ?? ''} v${run.toVersion}` });
      downloadBlob(new Blob([text], { type: 'text/plain' }), `${run.name ?? run.productName ?? 'generation'}-v${run.toVersion}-log.txt`);
    },

    async downloadBundle() {
      const run = this.current;
      if (this.bundling) return;
      this.bundling = true;
      try {
        const version = this.messages.find((m) => m.version)?.version ?? run.toVersion;
        const zip = await productService.downloadGenerationBundle({ id: run.productId, version });
        downloadBlob(zip, `${run.name ?? run.productName ?? 'generation'}-v${version}-bundle.zip`);
      } catch (error) {
        this.$emit('error', error.response?.data?.error || 'error_messages.error_generating_zip');
      } finally {
        this.bundling = false;
      }
    },

    // the code of the version this run made, as the archive of its tag
    async download() {
      const run = this.current;
      if (!run || this.downloading) return;
      this.downloading = true;
      try {
        const zip = await productService.versionZip({ id: run.productId, version: run.toVersion });
        downloadBlob(zip, `${run.name}-v${run.toVersion}.zip`);
      } catch (error) {
        this.$emit('error', error.response?.data?.error || 'error_messages.error_generating_zip');
      } finally {
        this.downloading = false;
      }
    },
  },
};
</script>

<style scoped lang="scss">
.gr__failure-detail {
  margin-top: 6px;
  summary { cursor: pointer; font-size: 0.85rem; }
  pre { margin: 6px 0; max-height: 160px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.8rem; }
}
.gr-layout {
  min-height: 360px;

  &--many { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 16px; transition: grid-template-columns 0.18s ease; }
  &--rail { grid-template-columns: 52px minmax(0, 1fr); }
}

.gr-list {
  min-width: 0;
  max-height: 600px;
  overflow-y: auto;
  padding-right: 12px;
  border-right: 1px solid var(--p-content-border-color);

  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }

  &__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; min-height: 32px; }
  &__summary { margin: 0; font-size: 0.8125rem; color: var(--text-muted); }

  // collapsed: only the state of each one, as the explorer of the app shows only what it can
  &--rail {
    padding-right: 8px;
    .gr-list__head { justify-content: center; }
    .gr-list__row { justify-content: center; padding: 8px 0; }
  }

  &__row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    text-align: left;
    cursor: pointer;
    background: none;
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--text-heading);
    font: inherit;

    &--on { border-color: var(--p-primary-color); background: color-mix(in srgb, var(--p-primary-color) 8%, transparent); }
  }

  &__main { min-width: 0; display: flex; flex-direction: column; }
  &__name { font-size: 0.875rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__ver { font-size: 0.75rem; color: var(--text-muted); }
}

.gr {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;

  &__head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border: 1px solid var(--p-content-border-color);
    border-left: 3px solid var(--p-primary-color);
    border-radius: 8px;

    > i { font-size: 1.4rem; }
    &--running > i { color: var(--p-primary-color); }
    &--success { border-left-color: var(--status-ok); > i { color: var(--status-ok); } }
    &--warning, &--waiting { border-left-color: var(--status-warn); > i { color: var(--status-warn); } }
    &--rejected { border-left-color: var(--text-muted); > i { color: var(--text-muted); } }
    &--error { border-left-color: var(--status-bad); > i { color: var(--status-bad); } }
    &--cancelled { border-left-color: var(--text-muted); > i { color: var(--text-muted); } }
  }

  &__head-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  &__name { font-size: 0.8125rem; font-weight: 600; color: var(--text-muted); }
  &__versions { display: inline-flex; align-items: center; gap: 8px; font-size: 1.0625rem; color: var(--text-heading); }
  &__versions strong { color: var(--p-primary-color); }
  &__head-sub { font-size: 0.8125rem; color: var(--text-muted); }
  &__estimated {
    padding: 0 7px;
    font-size: 0.6875rem;
    border-radius: 999px;
    color: var(--status-warn);
    background: var(--status-warn-soft);
    border: 1px solid var(--status-warn-border);
  }

  &__jobs { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  &__job {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    font-size: 0.8125rem;
    color: var(--text-muted);
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;

    &--success > i { color: var(--status-ok); }
    &--failed { border-color: var(--status-bad-border); color: var(--text-heading); > i { color: var(--status-bad); } }
    &--running { color: var(--text-heading); > i { color: var(--p-primary-color); } }
  }
  &__job-name { font-weight: 600; color: var(--text-heading); }
  &__job-stage { font-size: 0.6875rem; letter-spacing: 0.06em; text-transform: uppercase; }
  &__job-status { margin-left: auto; }
  &__job-time { min-width: 4ch; text-align: right; font-variant-numeric: tabular-nums; }
  &__job-link { color: var(--text-muted); }

  &__failed {
    margin-top: 10px;
    padding: 10px 12px;
    border: 1px solid var(--status-bad-border);
    background: var(--status-bad-soft);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  &__failed-title { margin: 0; display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--status-bad); }
  &__failed-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  &__failed-hint { font-size: 0.8125rem; color: var(--text-muted); }
  &__trace {
    margin: 0;
    max-height: 180px;
    overflow: auto;
    padding: 8px 10px;
    font-size: 0.75rem;
    line-height: 1.45;
    background: var(--p-content-background);
    border: 1px solid var(--p-content-border-color);
    border-radius: 6px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  &__spec {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;
    background: color-mix(in srgb, var(--p-primary-color) 4%, transparent);
  }
  &__spec-icon { font-size: 1.1rem; color: var(--p-primary-color); }
  &__spec-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  &__spec-title { font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
  &__spec-sub { font-size: 0.8125rem; color: var(--text-muted); }
  &__spec-chips { display: flex; flex-wrap: wrap; gap: 4px 16px; }

  &__note { margin: 0; padding: 12px 4px; display: flex; align-items: center; gap: 8px; font-size: 0.8125rem; color: var(--text-muted); }

  // the generation, its commit and its pipeline: a PrimeVue Stepper, its own step shown underneath
  &__stepper { margin-top: 16px; :deep(.p-steppanels) { padding: 16px 0 0; background: none; } }

  &__step-btn {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    font: inherit;
    font-size: 0.8125rem;
    color: var(--text-muted);
    background: none;
    border: 0;
    border-bottom: 2px solid var(--p-content-border-color);
    cursor: pointer;

    &--done .gr__step-btn-dot { color: var(--status-ok); }
    &--active .gr__step-btn-dot { color: var(--p-primary-color); }
    &--waiting .gr__step-btn-dot { color: var(--status-warn); }
    &--failed .gr__step-btn-dot { color: var(--status-bad); }
    &--skipped { opacity: 0.75; }
    &--sel { color: var(--text-heading); border-bottom-color: var(--p-primary-color); }
  }
  &__step-btn-dot { font-size: 1.1rem; line-height: 1; flex-shrink: 0; }
  &__step-btn-label { min-width: 0; text-align: left; }

  &__stage-body { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  &__stage-count { margin: 0; font-size: 0.75rem; color: var(--text-muted); }

  &__summary { display: flex; flex-direction: column; gap: 16px; }
  &__section h4 { margin: 0 0 6px; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }

  &__changes {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    padding: 10px 12px;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: var(--text-heading);
    background: transparent;
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;

    &:hover { border-color: var(--p-primary-color); }
    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 1px; }
  }
  &__chip { display: inline-flex; align-items: center; gap: 6px; font-size: 0.8125rem; }
  &__changes-go { margin-left: auto; font-size: 0.8125rem; color: var(--p-primary-color); display: inline-flex; gap: 6px; align-items: center; }

  &__log {
    max-height: 340px;
    overflow-y: auto;
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;
    padding: 4px 0;

    :deep(.log-item__message) { white-space: normal; overflow-wrap: anywhere; }
  }

  &__located-log {
    background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
    box-shadow: inset 3px 0 0 var(--p-primary-color);
  }
  &__located { outline: 2px solid var(--p-primary-color); outline-offset: 2px; border-radius: 8px; }

  &__state { margin: 0; padding: 12px 4px; font-size: 0.8125rem; color: var(--text-muted); }

  &__deploy { display: flex; flex-direction: column; gap: 12px; }

  &__pipeline {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;

    > i { font-size: 1.3rem; color: var(--text-muted); }
    &--ok > i { color: var(--status-ok); }
    &--bad { border-color: var(--status-bad-border); > i { color: var(--status-bad); } }
    &--run > i { color: var(--p-primary-color); }
  }

  &__pipeline-text { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  &__pipeline-title { font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
  &__pipeline-status { font-size: 0.9375rem; font-weight: 600; color: var(--text-heading); }
  &__pipeline-link { font-size: 0.8125rem; }

  &__label { margin-right: 8px; font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase; }
  &__confirm { margin-right: auto; font-size: 0.8125rem; color: var(--text-heading); }
}

@media (max-width: 760px) {
  .gr__step-btn-label { font-size: 0.75rem; }
  .gr-layout--many { grid-template-columns: minmax(0, 1fr); }
  .gr-list { border-right: 0; padding-right: 0; max-height: 200px; }
}
</style>
