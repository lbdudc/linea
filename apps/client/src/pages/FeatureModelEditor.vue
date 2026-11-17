<template>
  <LineShell :id="id" ref="shell" active="model" fill>
  <div class="fm-root">
  <div v-if="models.length > 1" class="fm-models" role="tablist" :aria-label="$t('modules.line_models')">
    <button
      v-for="m in models"
      :key="m.metamodel"
      type="button"
      role="tab"
      class="views__tab fm-models__tab"
      :class="{ 'views__tab--active': current === m.metamodel }"
      :aria-selected="current === m.metamodel"
      :name="`model-${m.metamodel}`"
      @click="selectModel(m.metamodel)"
    >
      <span class="ident">{{ m.metamodel }}</span>
      <span class="fm-models__level">{{ $t('modules.level_n', { n: m.level }) }}</span>
      <i v-if="m.readOnly" class="pi pi-lock" aria-hidden="true" />
      <i v-else-if="isDirty(m.metamodel)" class="pi pi-circle-fill fm-models__dirty" :title="$t('modules.unsaved')" aria-hidden="true" />
    </button>
  </div>

  <div class="fm-barra">
    <div class="views" role="tablist" :aria-label="$t('modules.views')">
      <button
        v-for="v in allViews"
        :key="v.id"
        type="button"
        role="tab"
        class="views__tab"
        :class="{ 'views__tab--active': shownView === v.id }"
        :aria-selected="shownView === v.id"
        :name="viewName(v.id)"
        :title="v.title"
        @click="chosenViews = { ...chosenViews, [current]: v.id }"
      >
        <i class="pi" :class="v.icon" aria-hidden="true" /> {{ v.text }}
      </button>
    </div>

    <div class="fm-barra__hueco" />

    <PluginSlot name="featureModel.strip" :context="slotContext" />

    <ModelActions
      :loading="modelLoading"
      :read-only="readOnly"
      :has-content="Boolean(fileContent)"
      @save="saveFeatureModel"
    >
      <ImpactAction :line-id="id" :uvl="uvl" :is-feature-model="isFeatureModel" />
      <PluginSlot name="featureModel.actions" :context="slotContext" />
    </ModelActions>
  </div>

  <div class="fm-body">
    <div class="fm-editor-panel">
      <div class="fm-editor-wrap" :class="{ 'fm-editor-wrap--skeleton': modelLoading }">
        <template v-if="modelLoading">
          <Skeleton
            v-for="line in 14"
            :key="`ed-sk-${line}`"
            height="12px"
            :width="`${[70, 45, 55, 35, 60, 40][line % 6]}%`"
          />
        </template>
        <BangoWorkbench
          v-else-if="bundle"
          ref="workbench"
          class="fm-workbench"
          :bundle="bundle"
          :metamodels="metamodels"
          :offered="offered"
          :offered-metamodels="offered.map((o) => o.metamodel)"
          :metamodel="current"
          :view="shownView"
          @states="onStates"
        />
      </div>
      <DiagnosticList v-if="problems.length" :diagnostics="problems" />
    </div>

    <PluginSlot name="featureModel.panels" :context="slotContext" />
  </div>

  <SaveConfirmationDialog
    v-if="fileContent"
    v-model:dialog="showSaveDialog"
    @saved="onSaved"
    :lineId="id"
    :content="fileContent"
    :uvl="uvl"
    :metamodel="current"
    :modelPath="modelPath"
  />
  </div>
  </LineShell>
</template>

<script>
import { notify } from 'src/composables/useNotify';
import { defineAsyncComponent } from 'vue';
import PanelGhost from '../components/feature-model/PanelGhost.vue';
import SaveConfirmationDialog from '../components/feature-model/SaveConfirmationDialog.vue';
import lineService from 'src/services/lineService';
import PluginSlot from 'components/common/PluginSlot.vue';
import LineShell from 'components/line/LineShell.vue';
import ImpactAction from '../components/feature-model/ImpactAction.vue';
import ModelActions from '../components/feature-model/ModelActions.vue';
import DiagnosticList from 'components/modules/DiagnosticList.vue';
import Skeleton from 'primevue/skeleton';
import Tooltip from 'primevue/tooltip';
import { BASIC_VIEWS } from 'components/modules/modelViews';

// The editor brings Monaco: it loads after the page is up, so the header, the actions and the requests for the model do not wait for it.
// A ghost holds its place meanwhile.
const lazy = (loader) => defineAsyncComponent({ loader, loadingComponent: PanelGhost, delay: 0 });
const BangoWorkbench = lazy(() => import('../components/modules/BangoWorkbench.vue').then((m) => m.default));

export default {
  name: 'FeatureModelEditor',
  components: { LineShell, ImpactAction, ModelActions, BangoWorkbench, SaveConfirmationDialog, DiagnosticList, PluginSlot, Skeleton },
  directives: { tooltip: Tooltip },
  props: {
    id: { type: String, required: true }
  },
  data() {
    return {
      // the feature model as a model of the feature metamodel (what is edited and saved), and as UVL (what the analysis and the impact work on)
      // every model of a level above 0 the SPL has: what is edited, and what is saved, of each
      models: [],
      current: 'featuremodel',
      texts: {},
      saved: {},
      uvl: '',
      bundle: null,
      problems: [],
      chosenViews: {},
      engineTick: 0,
      // the feature model of a line made of modules is composed from them: it is shown, not saved
      debounceTimer: null,
      previewAbort: null,
      // the model could not be turned into UVL: what a plugin that analyses it must not try
      uvlInvalid: false,
      modelLoading: true,
      showSaveDialog: false,
    };
  },
  computed: {
    readOnly() {
      return Boolean(this.models.find((m) => m.metamodel === this.current)?.readOnly);
    },
    isFeatureModel() {
      return this.current === 'featuremodel';
    },
    fileContent() {
      return this.texts[this.current] ?? '';
    },
    savedContent() {
      return this.saved[this.current] ?? '';
    },
    levelOfCurrent() {
      return this.models.find((m) => m.metamodel === this.current)?.level ?? 1;
    },
    // the models of the level being looked at are what the engine edits; the ones above are offered to them, read-only
    metamodels() {
      return this.models.filter((m) => m.level === this.levelOfCurrent).map((m) => ({ name: m.metamodel, model: this.texts[m.metamodel] ?? '' }));
    },
    offered() {
      return this.models.filter((m) => m.level > this.levelOfCurrent).map((m) => ({ origin: `level-${m.level}`, metamodel: m.metamodel, text: this.texts[m.metamodel] ?? m.text }));
    },
    // the views of bango and the ones the feature metamodel brings: the person chooses how the feature model is configured
    allViews() {
      const brought = this.engineTick >= 0 ? (this.$refs.workbench?.views?.(this.current) ?? []) : [];
      // the views of the feature metamodel first (UVL, XML, the feature diagram), then the text and the form
      return [
        ...brought.map((v) => ({ id: v.id, text: v.label, icon: 'pi-objects-column', title: v.error ?? v.description })),
        ...BASIC_VIEWS.map((v) => ({ id: v.id, text: this.$t(`modules.${v.label}`), icon: v.icon })),
      ];
    },
    shownView() {
      const wanted = this.chosenViews[this.current] ?? (this.isFeatureModel ? 'viz:uvl' : this.allViews[0]?.id);
      return this.allViews.some((v) => v.id === wanted) ? wanted : 'text';
    },
    // what the plugins that add to this page (the figures of the model, an analysis panel...) are told about it
    slotContext() {
      return {
        lineId: this.id,
        uvl: this.uvl,
        uvlInvalid: this.uvlInvalid,
        readOnly: this.readOnly,
        isFeatureModel: this.isFeatureModel,
        loading: this.modelLoading,
        requestSave: this.saveFeatureModel,
      };
    },
    hasUnsavedChanges() {
      return !this.modelLoading && this.models.some((m) => !m.readOnly && this.isDirty(m.metamodel));
    },
    modelPath() {
      return this.models.find((m) => m.metamodel === this.current)?.file ?? 'models/featuremodel.featuremodel';
    },
  },
  mounted() {
    this.getFeatureModel();
    window.addEventListener('beforeunload', this.warnBeforeUnload);
  },
  // leaving by the side bar, the back arrow or the browser must not lose the edit without asking
  beforeRouteLeave() {
    if (this.hasUnsavedChanges && !window.confirm(this.$t('labels.unsaved_model_leave'))) return false;
  },
  beforeUnmount() {
    if (this.previewAbort) this.previewAbort.abort();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    window.removeEventListener('beforeunload', this.warnBeforeUnload);
  },
  methods: {
    viewName(id) { return `view-${id.replace(/[^\w-]/g, '-')}`; },
    // the model is committed: what the header shows of the line (its version) moved with it
    onSaved() {
      this.saved = { ...this.saved, [this.current]: this.fileContent };
      this.$refs.shell?.reload?.();
    },
    isDirty(metamodel) {
      return (this.texts[metamodel] ?? '') !== (this.saved[metamodel] ?? '');
    },
    selectModel(metamodel) {
      this.current = metamodel;
      this.engineTick++;
    },
    warnBeforeUnload(event) {
      if (!this.hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    },
    // what the engine of the editor says of the model each time it changes
    onStates(states) {
      this.engineTick++;
      // what the engine holds is the models of the level in front: the text of each is what is edited
      for (const state of states) {
        if (this.models.some((m) => m.metamodel === state.metamodel) && this.levelOf(state.metamodel) === this.levelOfCurrent) this.updateFileContent(state.text, state.metamodel);
      }
      const state = states.find((s) => s.metamodel === this.current);
      if (!state) return;
      this.problems = (state.problems || [])
        .filter((p) => p.severity === 'error' || p.severity === 'warning')
        .map((p) => ({ severity: p.severity, package: '', message: `${p.startLine + 1}:${p.startColumn + 1} ${p.message}` }));
    },
    levelOf(metamodel) {
      return this.models.find((m) => m.metamodel === metamodel)?.level;
    },
    updateFileContent(newContent, metamodel = this.current) {
      if ((this.texts[metamodel] ?? '') === newContent) return;
      this.texts = { ...this.texts, [metamodel]: newContent };
      // what is worked out from it (UVL, for the impact and for the plugins) is of the feature model
      if (metamodel !== 'featuremodel') return;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.refreshUvl(), 600);
    },
    // the UVL of what is being edited, for the impact and the plugins: the server works it out with the rest of the SPL
    async refreshUvl() {
      if (this.previewAbort) this.previewAbort.abort();
      this.previewAbort = new AbortController();
      try {
        const answer = await lineService.previewFeatureModel({ id: this.id, content: this.texts.featuremodel, signal: this.previewAbort.signal });
        this.uvlInvalid = !answer.ok;
        if (answer.ok) this.uvl = answer.uvl;
      } catch (err) {
        if (err.name === 'CanceledError' || err.name === 'AbortError') return;
        this.uvlInvalid = true;
      }
    },
    async getFeatureModel() {
      this.modelLoading = true;
      try {
        const response = await lineService.getFeatureModel({ id: this.id });
        this.bundle = response.bundle;
        // the feature model is the one every SPL has; the models of the other metamodels of a level above 0 come with it
        this.models = (response.models?.length ? response.models : [{ metamodel: 'featuremodel', level: 1, text: response.text ?? '', file: 'models/featuremodel.featuremodel', stored: true, readOnly: Boolean(response.readOnly) }])
          .sort((a, b) => (a.metamodel === 'featuremodel' ? -1 : b.metamodel === 'featuremodel' ? 1 : b.level - a.level || a.metamodel.localeCompare(b.metamodel)));
        this.texts = Object.fromEntries(this.models.map((m) => [m.metamodel, m.text]));
        this.saved = { ...this.texts };
        this.current = 'featuremodel';
        this.uvl = response.uvl ?? '';
      } catch (error) {
        const msg = error.response
          ? this.$t(error.response.data?.error || 'error_messages.load_model')
          : this.$t('error_messages.no_server_response');
        notify({ type: 'negative', message: msg, position: 'bottom-right', timeout: 3000 });
      } finally {
        this.modelLoading = false;
      }
    },

    saveFeatureModel() {
      this.showSaveDialog = true;
    },
  },
};
</script>

<style scoped lang="scss">
.fm-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  margin: 16px 20px 20px;
  border: 1px solid var(--tile-border);
  border-radius: 10px;
  background: var(--tile-bg);
}

.fm-barra {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--p-content-border-color);

  &__formato {
    flex-shrink: 0;
    padding: 3px 8px;
    border: 1px solid var(--p-text-faint-color);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--p-text-secondary-color);
  }

  &__sep {
    width: 1px;
    height: 18px;
    flex-shrink: 0;
    background: var(--p-content-border-color);
  }

  &__accion {
    flex-shrink: 0;
    white-space: nowrap;
  }

  &__hueco { flex-grow: 1; }
}

.fm-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 470px;

  @media (max-width: 1499px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.fm-editor-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-right: 1px solid var(--p-content-border-color);
  background: var(--code-bg);
}

.fm-panel-header {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--card-border);
  background: var(--surface-alt);

  &__icon {
    margin-right: 4px;
  }

  &__title {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-muted);
  }
}

.fm-editor-wrap {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.fm-editor-wrap--skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 20px;
}

@media (max-width: 1100px) {
  .fm-editor-panel {
    display: none;
  }
}

.views { display: flex; gap: 2px; border: 1px solid var(--p-content-border-color); border-radius: 8px; padding: 2px; }
.views__tab { display: inline-flex; align-items: center; gap: 6px; background: none; border: 0; border-radius: 6px; padding: 5px 10px; font: inherit; font-size: 13px; color: var(--p-text-muted-color); cursor: pointer; }
.views__tab:hover { color: var(--p-text-color); }
.views__tab--active { background: var(--p-content-hover-background); color: var(--p-text-color); }
.fm-models { display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 14px 0; }
.fm-models__tab { border: 1px solid var(--p-content-border-color); }
.fm-models__level { font-size: 11px; color: var(--p-text-muted-color); }
.fm-models__dirty { font-size: 8px; color: var(--status-warn); }
.fm-workbench { width: 100%; }
</style>
