<template>
  <div class="page-root">
  <header class="detalle-cabecera">
    <PrimeButton
      text rounded size="small"
      class="detalle-cabecera__volver"
      name="product-back"
      :aria-label="$t('labels.go_back')"
      aria-haspopup="menu"
      @click="toggleBackMenu"
    >
      <template #icon><i class="pi pi-arrow-left" style="font-size: 18px" aria-hidden="true" /></template>
    </PrimeButton>
    <PrimeMenu ref="backMenu" :model="backMenuItems" popup />

    <div class="detalle-cabecera__texto">
      <!-- while the product arrives the title has its place held, so the buttons on the right do not move when it does -->
      <div v-if="!productData?.spec && !loadError" class="detalle-cabecera__title-row">
        <template v-if="preview">
          <h1 class="detalle-cabecera__title">{{ preview.name }}</h1>
          <span class="chip-version">v{{ preview.version }}</span>
        </template>
        <template v-else>
          <Skeleton width="220px" height="30px" />
          <Skeleton width="56px" height="22px" />
        </template>
      </div>
      <div v-else-if="productData?.spec" class="detalle-cabecera__title-row">
        <h1 class="detalle-cabecera__title">{{ productData.spec.basicData.name }}</h1>
        <span class="chip-version">v{{ productData.spec.basicData.version }}</span>

        <PendingDeployChip
          :deployment="productData.deployment"
          :busy="discarding"
          @generate="$refs.generateButton?.open()"
          @diff="openDiff"
          @discard="discardSaved"
        />

        <button
          v-if="healthData"
          type="button"
          class="detalle-cabecera__estado"
          :class="[
            productValid ? 'detalle-cabecera__estado--ok' : 'detalle-cabecera__estado--mal',
            { 'detalle-cabecera__estado--pulsable': !productValid },
          ]"
          :disabled="productValid"
          v-tooltip.bottom="!productValid ? invalidSummary : undefined"
          @click="!productValid && openInvalidModel()"
        >
          <span class="detalle-cabecera__punto" />
          {{ productValid ? $t('labels.migration_valid') : $t('labels.migration_invalid') }}
        </button>
        <Skeleton v-else-if="healthLoading" width="70px" height="18px" />
      </div>

    </div>

    <div class="detalle-cabecera__actions">
      <template v-if="gitlabInfo">
        <GitLabButton :id="gitlabInfo.id" :host="productData?.gitHost" :text="true" type="repository" :href="gitlabInfo.webUrl" />
        <GitLabButton :id="gitlabInfo.id" :text="true" type="code" :href="gitlabInfo.webIdeUrl" />
      </template>
      <template v-else-if="!loadError">
        <Skeleton width="76px" height="32px" />
        <Skeleton width="96px" height="32px" />
      </template>

      <!-- a sync puts the code back in line with the SPL; it does not change the version, so it is not one of the steps below -->
      <PrimeButton
        v-if="productData?.spec"
        outlined size="small" severity="secondary"
        name="product-sync"
        :loading="syncing"
        :disabled="Boolean(loadError) || syncing || lineDeleted || lacksWrite"
        :label="$t('automation.sync_now')"
        :aria-label="$t('automation.sync_now')"
        v-tooltip.bottom="lineDeleted ? $t('labels.product_unmaintained') : $t('automation.sync_tooltip')"
        @click="askSync"
      >
        <template #icon><i class="pi pi-sync" style="font-size: 14px" aria-hidden="true" /></template>
      </PrimeButton>

      <!-- the two steps of getting a change into the product, in order: save the specification, then generate its code -->
      <div class="detalle-cabecera__pasos" role="group" :aria-label="$t('generation.steps')">
        <PrimeButton
          outlined size="small"
          name="product-save"
          :disabled="Boolean(loadError) || savingProduct || lineDeleted"
          :loading="savingProduct"
          :class="{ quadrat: Boolean(productData?.spec) && (changes || dirtyModels.length > 0) }"
          :label="savingProduct ? $t('labels.saving') : $t('labels.save')"
          :aria-label="$t('labels.save')"
          v-tooltip.bottom="lineDeleted ? $t('labels.product_unmaintained') : $t('generation.save_tooltip')"
          @click="save"
        >
          <template #icon><i class="pi pi-save" style="font-size: 14px" aria-hidden="true" /></template>
        </PrimeButton>
        <GenerateButton
          ref="generateButton"
          :product-id="id"
          :product-name="productData.spec?.basicData?.name"
          :version="productData.spec?.basicData?.version"
          :loading="loadingGenerationButton"
          :disabled="Boolean(loadError) || lineDeleted || lacksWrite"
          :blocked="Boolean(productData?.spec) && (changes || dirtyModels.length > 0)"
          :issues="generationIssues"
          :pending="productData.deployment?.pending === true"
          :default-bump="syncAutomation?.generation?.bump ?? 'patch'"
          @blocked="notifyUnsaved"
          @generate="generateProduct"
        />
      </div>
    </div>
  </header>

  <div v-if="lineDeleted" class="line-deleted-banner" role="status" name="product-line-deleted">
    <i class="pi pi-exclamation-triangle" aria-hidden="true" />
    <span>{{ $t('labels.product_unmaintained_banner') }}</span>
  </div>

  <div v-if="productData" class="detalle-pestanas">
    <Tabs v-model:value="tab">
      <TabList>
        <Tab value="overview">{{ $t('labels.overview') }}</Tab>
        <Tab value="models">
          <span class="tab-models">
            {{ $t('labels.tab_config') }}
            <span v-if="modelsOkCount" class="tab-models__count tab-models__count--ok" v-tooltip.bottom="$t('modules.model_valid')">
              <i class="pi pi-check-circle" aria-hidden="true" />{{ modelsOkCount }}
            </span>
            <span v-if="modelsBadCount" class="tab-models__count tab-models__count--bad" v-tooltip.bottom="$t('labels.migration_invalid')">
              <i class="pi pi-times-circle" aria-hidden="true" />{{ modelsBadCount }}
            </span>
            <!-- holds the room of the counts until they are known, so the tabs after it do not move -->
            <span v-if="!modelsOkCount && !modelsBadCount" class="tab-models__count tab-models__count--ghost" aria-hidden="true">
              <i class="pi pi-check-circle" />0
            </span>
          </span>
        </Tab>
        <Tab value="mrs" name="tab-mrs">{{ $t('mrs.tab') }}</Tab>
        <Tab value="issues" name="tab-issues">{{ $t('issues.tab') }}</Tab>
        <Tab value="history">{{ $t('labels.tab_versions') }}</Tab>
        <Tab value="cicd" name="tab-cicd">{{ $t('labels.tab_cicd') }}</Tab>
        <Tab value="siblings">{{ $t('labels.tab_siblings') }}</Tab>
        <Tab value="settings">{{ $t('labels.tab_settings') }}</Tab>
      </TabList>
    </Tabs>
  </div>

  <div v-if="loadError" class="load-error" role="alert" name="product-load-error">
    <i class="pi pi-exclamation-triangle" aria-hidden="true" />
    <span>{{ loadError }}</span>
    <PrimeButton text size="small" :label="$t('labels.retry')" @click="getProductData" />
  </div>
  <input ref="hiddenUploader" type="file" class="hidden-uploader" @change="onHiddenUploaderChange" />
  <Tabs v-model:value="tab" class="tab-panels-fill">
    <TabPanels>

    <TabPanel value="overview">
      <div class="details-layout">
       <div class="details-layout__main">

        <!-- what is done to the product (and its files) in one row; its room is held while it arrives -->
        <div v-if="productLoading" class="overview-bar overview-bar--ghost" aria-hidden="true">
          <Skeleton width="300px" height="28px" />
          <Skeleton width="380px" height="28px" />
        </div>
        <div v-else class="overview-bar">
          <div class="overview-bar__buttons">
            <PrimeButton
              text size="small"
              :disabled="Boolean(loadError) || lineDeleted"
              :label="$t('labels.duplicate_product')"
              @click="$router.push({ path: `/lines/${productData.lineId}/new-product`, query: { duplicating: true } })"
            >
              <template #icon><i class="pi pi-copy" style="font-size: 14px" aria-hidden="true" /></template>
            </PrimeButton>
            <PrimeButton text size="small" :disabled="Boolean(loadError) || lineDeleted" :label="$t('labels.rename_product')" @click="renameProduct">
              <template #icon><i class="pi pi-pencil" style="font-size: 14px" aria-hidden="true" /></template>
            </PrimeButton>
            <PrimeButton text size="small" :disabled="lineDeleted" :label="$t('labels.import_spec')" @click="startImportJSON()">
              <template #icon><i class="pi pi-upload" style="font-size: 14px" aria-hidden="true" /></template>
            </PrimeButton>
          </div>
          <ul class="export-rows" :aria-label="$t('generation.export_title')">
            <li v-for="row in exportRows" :key="row.key" class="export-row" :name="`export-row-${row.key}`">
              <span class="export-row__label">
                {{ row.label }}
                <span v-if="row.version" class="chip-version">v{{ row.version }}</span>
              </span>
              <PrimeButton
                text size="small"
                :label="$t('generation.export_spec')"
                :loading="exporting === `${row.key}:spec`"
                :disabled="Boolean(exporting) || row.specDisabled"
                :name="`export-${row.key}-spec`"
                @click="runExport(`${row.key}:spec`, row.spec)"
              >
                <template #icon><i class="pi pi-download" style="font-size: 13px" aria-hidden="true" /></template>
              </PrimeButton>
              <PrimeButton
                text size="small"
                :label="$t('generation.export_code')"
                :loading="exporting === `${row.key}:zip`"
                :disabled="Boolean(exporting) || lineDeleted"
                :name="`export-${row.key}-zip`"
                @click="runExport(`${row.key}:zip`, row.zip)"
              >
                <template #icon><i class="pi pi-box" style="font-size: 13px" aria-hidden="true" /></template>
              </PrimeButton>
            </li>
          </ul>
        </div>

        <!-- the two ways the code of the product moves: a generation (a new version) and a sync (back in line with the SPL, same version) -->
        <div v-if="productLoading" class="ln-strip ln-strip--ghost" aria-hidden="true">
          <Skeleton height="86px" /><Skeleton height="86px" />
        </div>
        <div v-else class="ln-strip" name="product-actions">
          <GenerationCard
            :version="productData.deployment?.version ?? null"
            :pending="productData.deployment?.pending === true"
            :next-version="nextGenerationVersion"
            :disabled="Boolean(loadError) || lineDeleted || lacksWrite"
            @generate="$refs.generateButton?.open()"
            @diff="openDiff"
          />
          <p v-if="lacksWrite" class="level-note" data-test="level-note" role="note"><i class="pi pi-lock" aria-hidden="true" /> {{ $t('access.needDeveloper', { level: levelWord }) }}</p>
          <SyncCard
            :automation="syncAutomation"
            :last-run="lastSyncRun"
            :syncing="syncing"
            :loading="syncLoading"
            :disabled="Boolean(loadError) || lineDeleted || lacksWrite"
            @sync="askSync"
            @configure="openAutomation"
          />
        </div>

        <!-- how the product stands: whether it is valid, how its repository is -->
        <section v-if="productLoading" class="state state--ghost" aria-hidden="true">
          <Skeleton v-for="i in 2" :key="i" height="62px" />
        </section>
        <section v-else class="state" name="product-state">
          <button type="button" class="state__cell state__cell--action" :class="{ 'state__cell--bad': !productValid && !lineDeleted }" name="state-config" @click="tab = 'models'">
            <span class="state__label">{{ $t('labels.state_config') }}</span>
            <strong class="state__value">{{ $t('labels.state_features', { n: selectedFeatures.length }) }}</strong>
            <span class="state__sub">{{ configText }}</span>
          </button>

          <div class="state__cell" :class="{ 'state__cell--warn': (activityData?.conflictingMRs ?? 0) > 0 || pipelineFailed }" name="state-repo">
            <span class="state__label">{{ $t('labels.state_repository') }}</span>
            <template v-if="activityData">
              <strong v-if="activityData.lastPipeline" class="state__value" :style="{ color: pipelineColorVar(activityData.lastPipeline.status) }">
                <i :class="pipelineIcon(activityData.lastPipeline.status)" aria-hidden="true" /> {{ activityData.lastPipeline.status }}
              </strong>
              <strong v-else class="state__value text-faint">{{ $t('labels.state_no_pipeline') }}</strong>
              <span class="state__sub">{{ repoText }}</span>
              <button
                v-if="(activityData.conflictingMRs ?? 0) > 0"
                type="button"
                class="state__sub state__resolve"
                name="resolve-conflicts"
                @click="conflictsOpen = true"
              >{{ $t('generation.cr_title') }}</button>
            </template>
            <Skeleton v-else width="90px" height="18px" />
          </div>
        </section>

        <section v-if="!productLoading" class="block" name="summary-models">
          <header class="block__head">
            <span class="block__title">{{ $t('labels.state_models') }}</span>
            <span class="block__rule" />
            <button type="button" class="state__link" @click="tab = 'models'">{{ lineDeleted ? $t('labels.state_view_config') : $t('labels.state_edit_config') }}</button>
          </header>
          <div v-if="staleModels.length" class="model-stale" name="models-out-of-sync">
            <i class="pi pi-exclamation-triangle" aria-hidden="true" />
            <span>{{ $t('modules.models_out_of_sync', { list: staleModels.join(', ') }) }}</span>
            <button type="button" class="state__link" :disabled="syncingModels || lineDeleted" name="sync-models" @click="syncModels">{{ $t('modules.sync_models') }}</button>
          </div>
          <ul class="model-rows">
            <li v-for="m in modelRows" :key="m.id" class="model-row" :name="`model-row-${m.id}`">
              <span class="model-row__dot" :class="[`model-row__dot--${m.status}`, { 'model-row__dot--pending': m.pending && m.status !== 'bad' }]" :title="m.pending ? $t('generation.pending_tooltip') : null" aria-hidden="true" />
              <span class="model-row__name">{{ m.title }}</span>
              <code v-if="m.key" class="model-row__key">{{ m.key }}</code>
              <span class="model-row__status" :class="`model-row__status--${m.status}`">{{ m.statusLabel }}</span>
              <span class="model-row__info">{{ m.info }}</span>
              <span class="model-row__spacer" />
              <button type="button" class="state__link" @click="openModel(m.id)">{{ $t('labels.state_open') }}</button>
            </li>
          </ul>
        </section>

        <section v-if="!productLoading" class="block" name="product-generations">
          <header class="block__head">
            <span class="block__title">{{ $t('labels.state_generations') }}</span>
            <span class="block__rule" />
            <button type="button" class="state__link" @click="tab = 'history'">{{ $t('labels.state_history') }}</button>
          </header>
          <ul v-if="recentVersions.length" class="gens">
            <li v-for="v in recentVersions" :key="v" class="gen">
              <span class="chip-version">v{{ v }}</span>
              <span v-if="productData.deployment?.version === v" class="gen__tag">{{ $t('labels.state_deployed') }}</span>
              <span class="gen__spacer" />
              <span
                v-if="versionPipelines[v]"
                class="gen__pipeline"
                :style="{ color: pipelineColorVar(versionPipelines[v].status) }"
              >● {{ $t(`generation.gr_pipeline_${pipelineWord(versionPipelines[v].status)}`) }}</span>
            </li>
          </ul>
          <p v-else-if="historyLoaded" class="block__empty">{{ $t('labels.state_no_generations') }}</p>
          <div v-else class="gens gens--ghost" aria-hidden="true">
            <Skeleton v-for="i in 3" :key="i" height="26px" />
          </div>
        </section>

        <div v-if="!productLoading && productData.members && productData.members.length" class="members-strip">
          <i class="pi pi-users text-muted" style="font-size: 14px" aria-hidden="true" />
          <span class="members-strip__label">{{ $t('labels.members') }}</span>
          <div class="members-strip__avatars">
            <Avatar
              v-for="m in productData.members.slice(0, 7)"
              :key="m.username"
              shape="circle"
              :label="m.username ? m.username[0].toUpperCase() : '?'"
              class="members-strip__avatar"
              :style="{ background: 'var(--p-button-primary-background)', color: 'var(--p-primary-contrast-color)', width: '22px', height: '22px', fontSize: '9px', fontWeight: 700 }"
              v-tooltip="m.username"
            />
            <span v-if="productData.members.length > 7" class="members-strip__overflow">
              +{{ productData.members.length - 7 }}
            </span>
          </div>
          <Tag v-if="productData.myLevel" :value="`${$t('access.yourRole')}: ${$t(`labels.role${productData.myLevel}`)}`" :severity="productData.myLevel >= 40 ? 'success' : 'secondary'" data-test="my-role" />
          <Button icon="pi pi-key" size="small" text :label="$t('access.open')" name="open-access" data-test="open-access" @click="showAccess = true" />
        </div>
        <AccessDialog v-if="showAccess" :id="String(productData._id ?? $route.params.id)" scope="product" :line-id="String(productData.lineId)" @close="showAccess = false" />

       </div>


      </div>


      <DeleteConfirmDialog
        v-model="confirmDelete"
        kind="product"
        :pending="Boolean(productData?.delayedDeletion)"
        :name="productData?.spec?.basicData?.name ?? ''"
        :loading="deleteLoading"
        @confirm="deleteProduct(productData._id)"
      />

      <PrimeMenu ref="versionMenu" :model="versionMenuItems" popup />
      <ConflictResolverDialog
        v-model:visible="conflictsOpen"
        :product-id="String(id)"
        @resolved="loadActivityData"
      />
      <SpecDiffDialog
        v-model:visible="versionDiff.open"
        readonly
        :loading="versionDiff.loading"
        :deployed="versionDiff.before"
        :saved="versionDiff.after"
        :models="versionDiff.models"
        :title="versionDiff.title"
        :from-label="versionDiff.from"
        :to-label="versionDiff.to"
      />
      <SpecDiffDialog
        v-model:visible="diffOpen"
        :loading="diffLoading"
        :deployed="diffData?.deployed ?? null"
        :saved="diffData?.saved ?? null"
        :models="diffData?.models ?? null"
        :busy="discarding"
        @discard="discardSaved"
        :version="diffData?.version ?? ''"
      />
      <GenerationResultDialog
        :visible="generationPanel && !generationMinimized"
        :runs="generationRuns"
        @update:visible="onResultVisible"
        @minimize="generationMinimized = true"
        @rollback="rollbackGeneration"
        @retry="generateProduct(lastBump)"
        @cancel="cancelGeneration"
        @error="notifyError"
        @decided="onUpdateDecided"
      />
      <GenerationResultDialog
        v-if="deploymentRuns.length"
        v-model:visible="deploymentOpen"
        :runs="deploymentRuns"
        @rollback="rollbackFromVersion"
        @error="notifyError"
      />
      <GenerationPanel
        :visible="generationPanel && generationMinimized"
        :running="loadingGenerationButton"
        :messages="messages"
        :version="generatingVersion"
        @close="generationPanel = false"
      />
      <GenerationRecord :dialog="record" :id="id" @close-dialog="record = false" />
    </TabPanel>

    <TabPanel value="models">
    <template v-if="visitedTabs.models">
      <div v-if="modularOverview && !selectorModels.length" class="panel-empty">
        <i class="pi pi-th-large text-faint" style="font-size: 48px" aria-hidden="true" />
        <div class="panel-empty__text">{{ $t('labels.no_data_available') }}</div>
      </div>
      <!-- the editor can fill the whole window (a product with many metamodels leaves little room under the page's header): the same
           instance is moved to the body, so what is being edited is kept -->
      <Teleport v-else to="body" :disabled="!modelsExpanded">
      <div class="models-layout-select" :class="{ 'models-layout-select--expanded': modelsExpanded }">
        <div class="model-selectors-bar">
          <div class="model-selectors">
            <template v-if="lineLoading || !modularOverview">
              <Skeleton v-for="i in 3" :key="i" height="34px" width="140px" class="model-selector-skeleton" />
            </template>
            <button
              v-for="m in selectorModels"
              v-else
              :key="m.id"
              type="button"
              class="model-selector"
              :class="{ 'model-selector--active': activeModelId === m.id }"
              :title="m.title"
              @click="modelSubTab = m.id"
            >
              <span class="model-selector__dot" :class="[`model-selector__dot--${m.status}`, { 'model-selector__dot--pending': m.pending && m.status !== 'bad' }]" :title="m.pending ? $t('generation.pending_tooltip') : null" />
              <span class="model-selector__body">
                <span class="model-selector__name">{{ m.title }}</span>
                <span class="model-selector__status">{{ m.statusLabel }}</span>
              </span>
              <span class="model-selector__key ident">{{ m.key ?? m.id }}</span>
            </button>
          </div>
          <PrimeButton
            outlined size="small"
            name="models-expand"
            :icon="modelsExpanded ? 'pi pi-window-minimize' : 'pi pi-window-maximize'"
            :label="modelsExpanded ? $t('labels.models_collapse') : $t('labels.models_expand')"
            :aria-pressed="modelsExpanded"
            @click="toggleModelsExpanded"
          />
        </div>

        <div class="model-editor">
          <div v-if="lineDeleted && activeSelectorModel.metamodel" class="model-readonly" name="models-read-only">
            <div class="model-readonly__bar">
              <span class="ident">.linea/models/{{ activeSelectorModel.metamodel }}.{{ activeSelectorModel.key }}</span>
              <span class="model-readonly__tag"><i class="pi pi-lock" aria-hidden="true" /> {{ $t('modules.read_only') }}</span>
            </div>
            <pre class="ident model-readonly__text" name="model-readonly-text">{{ activeModelText }}</pre>
          </div>
          <!-- a line made of modules: the models of the metamodels its modules need, edited with bango's views. One engine serves all of
               them, so it stays while another model is looked at -->
          <ProductModelsEditor
            v-if="!lineDeleted && modularOverview && !modularOverview.summary && visitedMetamodel"
            v-show="activeSelectorModel.metamodel"
            ref="modelsEditor"
            :key="modelsEditorKey"
            :product-id="id"
            :overview="modularOverview"
            :metamodel="activeSelectorModel.metamodel ?? lastMetamodel"
            @states="onModelStates"
            @saved="onModelsSaved"
          />
          <div v-if="activeSelectorModel.metamodel && !modelsPending" />
          <div v-else-if="modelsPending" class="panel-empty" name="models-loading">
            <Skeleton width="45%" height="16px" />
            <Skeleton width="30%" height="12px" />
          </div>
          <div v-else-if="modularOverview" class="panel-empty" name="models-empty">
            <i class="pi pi-ban text-faint" style="font-size: 48px" aria-hidden="true" />
            <div class="panel-empty__text">{{ $t('labels.model_not_configured') }}</div>
            <div class="panel-empty__text">{{ $t('labels.model_not_configured_desc') }}</div>
          </div>
        </div>
      </div>
      </Teleport>
    </template>
    </TabPanel>

    <TabPanel value="siblings">
    <template v-if="visitedTabs.siblings">
      <div class="ln-panel">

        <div class="ln-block">
        <div class="section-header section-header--padded">
          <i class="pi pi-box text-muted" style="font-size: 15px" aria-hidden="true" />
          <span class="section-header__title">{{ $t('labels.other_products') }}</span>
          <Badge
            :value="filteredSiblings.length"
            severity="secondary"
            :style="{ background: 'var(--status-neutral-solid)', color: 'var(--status-on-solid)' }"
          />
          <span class="section-header__actions">
            <PrimeButton
              v-if="filteredSiblings.length" text size="small" icon="pi pi-copy" name="siblings-apply"
              :label="$t('apply_config.open')" :disabled="!healthData?.features?.length" @click="applyOpen = true"
            />
            <PrimeButton
              text size="small" icon="pi pi-plus" name="siblings-create-from"
              :label="$t('apply_config.create_from')"
              @click="$router.push({ path: `/lines/${productData.lineId}/new-product`, query: { duplicating: true } })"
            />
          </span>
        </div>

        <div v-if="lineLoading" class="panel-empty">
          <ProgressSpinner
            style="width: 32px; height: 32px"
            :dt="{ colorOne: 'var(--p-primary-color)', colorTwo: 'var(--p-primary-color)', colorThree: 'var(--p-primary-color)', colorFour: 'var(--p-primary-color)' }"
          />
        </div>
        <div v-else-if="filteredSiblings.length" class="siblings-grid">
          <div
            v-for="sibling in sortedSiblings"
            :key="sibling._id"
            class="sibling-card"
            :class="{ 'sibling-card--active': comparisonSiblingId === String(sibling._id) }"
          >
            <div class="sibling-card__header">
              <span class="sibling-card__name" :title="sibling.name">{{ sibling.name }}</span>
              <Tag
                class="sibling-card__version"
                :style="{ background: 'var(--status-neutral-solid)', color: 'var(--status-on-solid)' }"
              >v{{ sibling.version }}</Tag>
            </div>
            <div class="sibling-card__chips">
              <Skeleton v-if="!siblingStatus[String(sibling._id)]" width="64px" height="18px" />
              <template v-else>
                <Tag
                  v-if="siblingStatus[String(sibling._id)].valid === false"
                  class="sibling-chip sibling-chip--bad"
                  v-tooltip.bottom="siblingStatus[String(sibling._id)].error || $t('labels.health_invalid_desc')"
                >{{ $t('labels.migration_invalid') }}</Tag>
                <Tag v-else-if="siblingStatus[String(sibling._id)].valid" class="sibling-chip sibling-chip--ok">{{ $t('labels.migration_valid') }}</Tag>
                <Tag v-if="siblingStatus[String(sibling._id)].pending" class="sibling-chip sibling-chip--warn">{{ $t('labels.sibling_pending') }}</Tag>
              </template>
            </div>
            <div class="sibling-card__diff">
              <template v-if="siblingDiff(sibling)">
                <div class="sibling-card__bar" role="img" :aria-label="$t('labels.sibling_similarity', { n: siblingDiff(sibling).similarity })">
                  <span class="sibling-card__bar-fill" :style="{ width: `${siblingDiff(sibling).similarity}%` }" />
                </div>
                <div class="sibling-card__counts">
                  <span v-tooltip.bottom="$t('labels.sibling_shared_tip')"><b>{{ siblingDiff(sibling).shared }}</b> {{ $t('labels.sibling_shared') }}</span>
                  <span class="sibling-card__count--here"><b>+{{ siblingDiff(sibling).onlyHere }}</b> {{ $t('labels.sibling_only_here') }}</span>
                  <span class="sibling-card__count--there"><b>+{{ siblingDiff(sibling).onlyThere }}</b> {{ $t('labels.sibling_only_there') }}</span>
                </div>
              </template>
              <Skeleton v-else height="34px" />
            </div>
            <div class="sibling-card__meta">{{ timeAgo(sibling.createdAt) }}</div>
            <div class="sibling-card__actions">
              <GitLabButton v-if="sibling.repo?.id" :id="sibling.repo.id" type="repository" :href="sibling.repo.webUrl" />
              <PrimeButton
                text size="small"
                :label="$t('labels.compare')"
                :loading="loadingSiblingHealth === String(sibling._id)"
                :style="{
                  color: comparisonSiblingId === String(sibling._id) ? 'var(--p-primary-color)' : 'var(--text-muted)',
                }"
                @click="selectSiblingForComparison(sibling)"
              >
                <template #icon>
                  <i :class="comparisonSiblingId === String(sibling._id) ? 'pi pi-arrow-right-arrow-left' : 'pi pi-clone'" style="font-size: 16px" aria-hidden="true" />
                </template>
              </PrimeButton>
              <PrimeButton
                text size="small"
                :label="$t('labels.open_product')"
                :style="{ color: 'var(--p-primary-color)' }"
                @click="$router.push(`/products/${sibling._id}`)"
              >
                <template #icon><i class="pi pi-external-link" style="font-size: 16px" aria-hidden="true" /></template>
              </PrimeButton>
            </div>
          </div>
        </div>

        <div v-else class="panel-empty">
          <i class="pi pi-box text-faint" style="font-size: 48px" aria-hidden="true" />
          <div class="panel-empty__text">{{ $t('labels.no_siblings') }}</div>
        </div>
        </div>

        <transition name="slide-down">
          <div v-if="comparisonSiblingId" class="comparison-panel">
            <div class="comparison-panel__header">
              <i class="pi pi-arrow-right-arrow-left text-muted" style="font-size: 15px" aria-hidden="true" />
              <span class="comparison-panel__title">
                <strong>{{ productData.spec?.basicData?.name }}</strong>
                &nbsp;vs&nbsp;
                <strong>{{ selectedSiblingForComparison?.name }}</strong>
              </span>
              <label class="comparison-panel__only">
                <input v-model="onlyDifferences" type="checkbox" name="comparison-only-differences">
                {{ $t('apply_config.only_differences') }}
              </label>
              <PrimeButton
                text rounded size="small"
                :aria-label="$t('labels.close_comparison')"
                @click="comparisonSiblingId = null"
              >
                <template #icon><i class="pi pi-times text-muted" style="font-size: 14px" aria-hidden="true" /></template>
              </PrimeButton>
            </div>

            <div v-if="!comparisonData" class="comparison-loading">
              <Skeleton v-for="i in 3" :key="i" height="80px" />
            </div>

            <div v-else class="comparison-grid">
              <div class="comparison-col comparison-col--current">
                <div class="comparison-col__header">
                  <span class="comparison-col__dot comparison-col__dot--current"></span>
                  Only in <strong>{{ comparisonData.currentName }}</strong>
                  <Badge
                    :value="comparisonData.onlyInCurrent.length"
                    class="comparison-col__badge"
                    :style="{ background: 'var(--p-button-primary-background)', color: 'var(--p-primary-contrast-color)' }"
                  />
                </div>
                <div class="comparison-col__chips">
                  <Tag
                    v-for="f in comparisonData.onlyInCurrent"
                    :key="f"
                    :style="{ background: 'var(--p-button-primary-background)', color: 'var(--p-primary-contrast-color)' }"
                  >{{ f }}</Tag>
                  <span v-if="!comparisonData.onlyInCurrent.length" class="comparison-col__empty">—</span>
                </div>
              </div>

              <div v-if="!onlyDifferences" class="comparison-col comparison-col--shared">
                <div class="comparison-col__header">
                  <span class="comparison-col__dot comparison-col__dot--shared"></span>
                  Shared
                  <Badge
                    :value="comparisonData.shared.length"
                    class="comparison-col__badge"
                    :style="{ background: 'var(--status-neutral-solid)', color: 'var(--status-on-solid)' }"
                  />
                </div>
                <div class="comparison-col__chips">
                  <Tag
                    v-for="f in comparisonData.shared"
                    :key="f"
                    :style="{ background: 'var(--status-neutral-solid)', color: 'var(--status-on-solid)' }"
                  >{{ f }}</Tag>
                  <span v-if="!comparisonData.shared.length" class="comparison-col__empty">—</span>
                </div>
              </div>

              <div class="comparison-col comparison-col--sibling">
                <div class="comparison-col__header">
                  <span class="comparison-col__dot comparison-col__dot--sibling"></span>
                  Only in <strong>{{ comparisonData.siblingName }}</strong>
                  <Badge
                    :value="comparisonData.onlyInSibling.length"
                    class="comparison-col__badge"
                    :style="{ background: 'var(--p-format-xml-solid)', color: 'var(--p-primary-contrast-color)' }"
                  />
                </div>
                <div class="comparison-col__chips">
                  <Tag
                    v-for="f in comparisonData.onlyInSibling"
                    :key="f"
                    :style="{ background: 'var(--p-format-xml-solid)', color: 'var(--p-primary-contrast-color)' }"
                  >{{ f }}</Tag>
                  <span v-if="!comparisonData.onlyInSibling.length" class="comparison-col__empty">—</span>
                </div>
              </div>
            </div>
          </div>
        </transition>

        <ApplyConfigurationDialog
          v-if="applyOpen"
          :from="productData.spec?.basicData?.name"
          :features="healthData?.features ?? []"
          :siblings="applyTargets"
          @close="applyOpen = false"
          @applied="onApplied"
        />
      </div>
    </template>
    </TabPanel>

    <TabPanel value="history">
    <template v-if="visitedTabs.history">
      <div class="ln-panel">

        <div class="ln-block">
        <div class="section-header section-header--padded">
          <i class="pi pi-history text-muted" style="font-size: 15px" aria-hidden="true" />
          <span class="section-header__title">{{ $t('labels.tab_versions') }}</span>
          <div class="history-filter" role="group" :aria-label="$t('automation.filter')">
            <button
              v-for="option in ['all', 'versions', 'syncs']"
              :key="option"
              type="button"
              class="history-filter__pill"
              :class="{ 'history-filter__pill--on': historyFilter === option, 'history-filter__pill--sync': option === 'syncs' }"
              :aria-pressed="historyFilter === option"
              :name="`history-filter-${option}`"
              @click="historyFilter = option"
            >{{ $t(`automation.filter_${option}`) }}</button>
          </div>
        </div>


        <div v-if="historyLoading" class="history-loading">
          <Skeleton v-for="i in 4" :key="i" height="44px" class="history-loading__row" />
        </div>

        <template v-else-if="historyVersions.length || syncRuns.length">
        <ProductHistoryTimeline
          :syncs="syncRuns"
          :filter="historyFilter"
          v-model:from="compareFrom"
          v-model:to="compareTo"
          :versions="historyVersions"
          :options="compareOptions"
          :version-pipelines="versionPipelines"
          :expanded-version="expandedVersion"
          :logs="historyLogs"
          :logs-loading="historyLogsLoading"
          :exporting="exporting"
          :armed-restore="armedRestore"
          :restoring="restoring"
          @compare="compareSelected"
          @toggle="toggleVersion"
          @open-deployment="openDeployment"
          @open-menu="openVersionMenu"
          @export-spec="(version) => runExport(`v${version}:spec`, () => exportVersionSpec(version))"
          @export-zip="(version) => runExport(`v${version}:zip`, () => zipVersion(version))"
          @restore="restoreVersion"
        />

        </template>

        <div v-else class="panel-empty">
          <i class="pi pi-clock text-faint" style="font-size: 48px" aria-hidden="true" />
          <div class="panel-empty__text">{{ $t('labels.no_history') }}</div>
        </div>
        </div>

      </div>
    </template>
    </TabPanel>

    <TabPanel value="mrs">
    <MergeRequestsPanel v-if="visitedTabs.mrs" kind="product" :id="String(id)" />
    </TabPanel>

    <TabPanel value="issues">
    <IssuesPanel v-if="visitedTabs.issues" kind="product" :id="String(id)" />
    </TabPanel>

    <TabPanel value="cicd">
    <ProductCicd @update-decided="onUpdateDecided" @rollback="rollbackGeneration" v-if="visitedTabs.cicd" :key="`cicd-${cicdKey}`" :product-id="String(id)" :initial-mode="cicdMode" @automation-saved="loadSyncAutomation" />
    </TabPanel>

    <TabPanel value="settings">
    <template v-if="visitedTabs.settings">
      <div class="ln-panel">

        <div class="settings-col">
          <fieldset class="settings-fields" :disabled="lineDeleted" name="settings-fields">
          <div class="ln-block">
            <div class="ln-block__head">
              <span class="ln-block__title">{{ $t('templates.title_issues') }}</span>
              <span class="ln-block__rule" />
            </div>
            <div class="config-section__body"><TemplatesEditor kind="product" :id="String(id)" subject="issue" /></div>
          </div>
          <div class="ln-block">
            <div class="ln-block__head">
              <span class="ln-block__title">{{ $t('templates.title_mrs') }}</span>
              <span class="ln-block__rule" />
            </div>
            <div class="config-section__body"><TemplatesEditor kind="product" :id="String(id)" subject="mr" /></div>
          </div>
          <div class="ln-block">
            <div class="ln-block__head">
              <span class="ln-block__title">{{ $t('labels.testing_environment') }}</span>
              <span class="ln-block__rule" />
            </div>
            <div class="config-section__body">
              <div class="test-env-row">
                <FloatLabel variant="on" class="test-env-col test-env-field">
                  <IconField>
                    <InputIcon><i class="pi pi-server" style="font-size: 14px" aria-hidden="true" /></InputIcon>
                    <InputText
                      id="test-env-image"
                      v-model="store.basicData.testEnvironment.image"
                      :placeholder="$t('labels.auto_detect')"
                      class="test-env-input"
                    />
                  </IconField>
                  <label for="test-env-image">{{ $t('labels.docker_image') }}</label>
                </FloatLabel>
                <PrimeButton
                  text rounded size="small"
                  class="test-env-field__preset-btn"
                  :aria-label="$t('labels.pick_preset_image')"
                  v-tooltip="$t('labels.pick_preset_image')"
                  @click="toggleImagePresetsMenu"
                >
                  <template #icon><i class="pi pi-angle-down" style="font-size: 18px" aria-hidden="true" /></template>
                </PrimeButton>
                <PrimeMenu ref="imagePresetsMenu" :model="testEnvImagePresetItems" popup>
                  <template #item="{ item, props }">
                    <div v-if="item.header" class="test-env-preset-header">
                      {{ item.label }}
                    </div>
                    <a v-else v-bind="props.action" class="test-env-preset-item">
                      <div class="test-env-preset-item__body">
                        <div class="test-env-preset-item__label">{{ item.label }}</div>
                        <div class="test-env-preset-item__caption">{{ item.caption }}</div>
                      </div>
                      <i
                        v-if="store.basicData.testEnvironment.image === item.value"
                        class="pi pi-check"
                        style="font-size: 14px; color: var(--p-primary-color)"
                        aria-hidden="true"
                      />
                    </a>
                  </template>
                </PrimeMenu>

                <FloatLabel variant="on" class="test-env-col">
                  <IconField>
                    <InputIcon><i class="pi pi-code" style="font-size: 14px" aria-hidden="true" /></InputIcon>
                    <InputText
                      id="test-env-cmd"
                      v-model="store.basicData.testEnvironment.command"
                      :placeholder="$t('labels.auto_detect')"
                      class="test-env-input"
                    />
                  </IconField>
                  <label for="test-env-cmd">{{ $t('labels.test_command') }}</label>
                </FloatLabel>
              </div>
              <div class="config-caption text-muted">{{ $t('labels.testing_environment_hint') }}</div>
            </div>
          </div>

          <div class="ln-block">
            <div class="ln-block__head">
              <span class="ln-block__title">{{ $t('labels.show_db_configuration') }}</span>
              <span class="ln-block__rule" />
            </div>
            <div class="config-section__body">
              <DatabaseConfiguration
                v-if="store"
                :config="{ ...store.basicData.database }"
                @update-config="(newVal) => (store.basicData.database = newVal)"
              />
            </div>
          </div>

          </fieldset>

          <div class="ln-block">
            <div class="ln-block__head">
              <span class="ln-block__title" style="color: var(--status-bad)">{{ $t('labels.danger_zone') }}</span>
              <span class="ln-block__rule" />
            </div>
            <div class="danger-row">
              <p class="danger-row__text text-muted">{{ $t('labels.danger_zone_delete_hint') }}</p>
              <span v-tooltip="cannotDelete(String(id)) ? { value: $t('labels.delete_needs_owner'), class: 'tooltip-wide', fitContent: false } : null">
                <PrimeButton
                  outlined
                  severity="danger"
                  name="product-delete"
                  :label="$t('labels.delete')"
                  :disabled="cannotDelete(String(id))"
                  @click.stop="confirmDelete = true"
                >
                  <template #icon><i class="pi pi-trash" style="font-size: 15px" aria-hidden="true" /></template>
                </PrimeButton>
              </span>
            </div>
          </div>
        </div>

      </div>
    </template>
    </TabPanel>

    </TabPanels>
  </Tabs>
  <ModelImportDialog v-model:visible="showModelImport" :report="modelImport" />
  <SyncPreviewDialog v-if="productData?.spec" v-model:visible="syncPreview" :product-id="id" :product-name="productData.spec.basicData.name" @confirm="runSync" />
  </div>

</template>

<script>
import { offerRollbackUndo } from 'src/composables/useRollbackUndo';
import { notify } from 'src/composables/useNotify';
import runStore from 'stores/runStore'
import productService from 'src/services/productService';
import lineService from 'src/services/lineService';
import logService from 'src/services/logService';
import GitLabButton from '../components/common/GitLabButton.vue';
import SyncPreviewDialog from 'src/components/changelog/SyncPreviewDialog.vue';
import GenerateButton from 'src/components/generation/GenerateButton.vue';
import { bumpVersion } from 'src/utils/bumpVersion';

// stands for what is saved, next to the versions, in the comparison of the history
const SAVED = 'saved';
import store from 'stores/productState';
import { gitHosts, hostRunsPipelines, loadGitHosts } from 'stores/gitHosts';
import { portfolioFreshness } from 'stores/portfolioFreshness';
import { usePortfolio, refresh as refreshPortfolio } from 'src/composables/usePortfolio';
import { useDeletable } from 'src/composables/useDeletable';
import DatabaseConfiguration from 'src/components/database/DatabaseConfiguration.vue';
import GenerationPanel from 'src/components/generation/GenerationPanel.vue';
import GenerationResultDialog from 'src/components/generation/GenerationResultDialog.vue';
import { pastRunOf } from 'src/utils/pastRun';
import PendingDeployChip from 'src/components/generation/PendingDeployChip.vue';
import SpecDiffDialog from 'src/components/generation/SpecDiffDialog.vue';
import ModelImportDialog from 'src/components/product/ModelImportDialog.vue';
import ConflictResolverDialog from 'src/components/generation/ConflictResolverDialog.vue';
import Menu from 'primevue/menu';
import GenerationRecord from 'src/components/generation/GenerationRecord.vue';
import productModelService from 'src/services/productModelService';
import { defineAsyncComponent } from 'vue';
import { socket } from '../boot/ws';
import DeleteConfirmDialog from '../components/common/DeleteConfirmDialog.vue'
import Button from 'primevue/button';
import Skeleton from 'primevue/skeleton';
import Tag from 'primevue/tag';
import Badge from 'primevue/badge';
import Avatar from 'primevue/avatar';
import AccessDialog from 'components/line/AccessDialog.vue';
import Tabs from 'primevue/tabs';
import TabList from 'primevue/tablist';
import Tab from 'primevue/tab';
import IssuesPanel from 'components/issues/IssuesPanel.vue';
import TemplatesEditor from 'components/issues/TemplatesEditor.vue';
import MergeRequestsPanel from 'components/mergeRequests/MergeRequestsPanel.vue';
import TabPanels from 'primevue/tabpanels';
import TabPanel from 'primevue/tabpanel';
import ProgressSpinner from 'primevue/progressspinner';
import FloatLabel from 'primevue/floatlabel';
import InputText from 'primevue/inputtext';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import Tooltip from 'primevue/tooltip';
import { pipelineWord, pipelineColorVar } from 'src/utils/pipelineStatus';
import ProductHistoryTimeline from 'src/components/generation/ProductHistoryTimeline.vue';
import ProductCicd from 'src/components/product/ProductCicd.vue';
import ApplyConfigurationDialog from 'src/components/product/ApplyConfigurationDialog.vue';
import GenerationCard from 'src/components/product/GenerationCard.vue';
import SyncCard from 'src/components/product/SyncCard.vue';
import { downloadBlob, downloadJson } from 'src/utils/download';
import { EMPTY_DIFF, LOADING_DIFF, previousVersionIn, diffOfVersion, diffVersionWithSaved, diffPoints } from 'src/utils/versionDiff';

const reader = new FileReader();

// loaded when a model of a metamodel is opened: it brings Monaco and bango's views with it
const ProductModelsEditor = defineAsyncComponent(() => import('src/components/modules/ProductModelsEditor.vue'));

export default {
  name: 'ProductDetail',
  components: {
    AccessDialog,
    ApplyConfigurationDialog,
    SyncPreviewDialog,
    GitLabButton,
    GenerateButton,
    DatabaseConfiguration,
    GenerationPanel,
    GenerationResultDialog,
    PendingDeployChip,
    SpecDiffDialog,
    ModelImportDialog,
    ConflictResolverDialog,
    GenerationRecord,
    ProductHistoryTimeline,
    ProductCicd,
    IssuesPanel,
    TemplatesEditor,
    MergeRequestsPanel,
    GenerationCard,
    SyncCard,
    ProductModelsEditor,
    DeleteConfirmDialog,
    PrimeButton: Button,
    PrimeMenu: Menu,
    Skeleton,
    Tag,
    Badge,
    Avatar,
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
    ProgressSpinner,
    FloatLabel,
    InputText,
    IconField,
    InputIcon,
  },
  directives: { tooltip: Tooltip },
  props: {
    id: { type: String, required: true }
  },
  setup(props) {
    // the lines and products the app already knows (what this browser kept, then what the server said): the head of the page is drawn
    // from them while the product itself is read
    const { products: portfolioProducts } = usePortfolio({ statuses: false });
    const cannotDelete = useDeletable({ ids: () => [String(props.id)], ask: (ids) => productService.getDeletableProducts({ ids }) });
    return { portfolioProducts, cannotDelete };
  },
  data() {
    return {
      showAccess: false,
      tab: 'overview',
      modelSubTab: null,
      // the sections of the Configuration tab: the models, and how the product generates and syncs
      cicdMode: 'status',
      cicdKey: 0,
      // sync: what the product is set to do and what it did last; the history filters versions from syncs
      syncAutomation: null,
      syncRuns: [],
      syncing: false,
      syncPreview: false,
      syncLoading: false,
      historyFilter: 'all',
      modularOverview: null,
      syncingModels: false,
      // the panels that were opened: the others are not built until they are
      visitedTabs: { overview: true },
      modelStates: {},
      dirtyModels: [],
      // bumped when the models were put back to something else: the editor starts again from what the repository holds now
      modelsEditorKey: 0,
      modelsLoading: 0,
      modelsFailed: false,
      modelImport: null,
      showModelImport: false,
      importedSpec: null,
      // the models editor fills the window
      modelsExpanded: false,
      lastMetamodel: null,
      productLoading: false,
      // the line whose products were asked for, so that asking while the product is read does not repeat it afterwards
      lineAskedFor: null,
      // why the product could not be read (its repository is gone, the git host does not answer): nothing is shown as if it loaded
      loadError: '',
      productData: {},
      loadingGenerationButton: false,
      savingProduct: false,
      deleteLoading: false,
      confirmDelete: false,
      changes: false,
      changesPoll: null,
      store,
      testEnvImagePresets: [
        { label: 'Local (no Docker)', value: 'local', caption: 'Run directly on the server' },
        { label: 'Node 20', value: 'node:20', caption: 'node:20' },
        { label: 'Node 22', value: 'node:22', caption: 'node:22' },
        { label: 'Maven + JDK 17', value: 'maven:3.9-eclipse-temurin-17', caption: 'maven:3.9-eclipse-temurin-17' },
        { label: 'Maven + JDK 21', value: 'maven:3.9-eclipse-temurin-21', caption: 'maven:3.9-eclipse-temurin-21' },
        { label: 'Gradle + JDK 21', value: 'gradle:8-jdk21', caption: 'gradle:8-jdk21' },
        { label: 'Python 3.12', value: 'python:3.12', caption: 'python:3.12' },
        { label: 'Go 1.22', value: 'golang:1.22', caption: 'golang:1.22' },
        { label: 'Rust 1.77', value: 'rust:1.77', caption: 'rust:1.77' },
      ],
      generationPanel: false,
      generatingVersion: '',
      generatingFrom: '',
      generationResult: null,
      generationCancelled: false,
      generationCancelling: false,
      generationCancelRefused: false,
      // how one version of the history was deployed: its generation, what it changed, and its pipeline when it is the last one
      deploymentOpen: false,
      versionPipelines: {},
      conflictsOpen: false,
      pipelinesWanted: false,
      pipelinesTimer: null,
      deploymentVersion: null,
      deploymentLogs: [],
      generationStartedAt: null,
      generationMinimized: false,
      lastBump: 'patch',
      diffOpen: false,
      diffLoading: false,
      diffData: null,
      discarding: false,
      // exports in flight (one at a time), the versions that kept their snapshot, and the history actions
      exporting: null,
      menuVersion: null,
      compareFrom: null,
      compareTo: null,
      armedRestore: null,
      restoring: false,
      versionDiff: { ...EMPTY_DIFF },
      record: false,
      messages: [],
      activityData: null,
      activityLoading: false,
      siblingProducts: [],
      lineLoading: false,
      healthData: null,
      healthLoading: false,
      historyVersions: [],
      historyLoading: false,
      historyLoaded: false,
      historyLogs: {},
      historyLogsLoading: {},
      expandedVersion: null,
      comparisonSiblingId: null,
      siblingHealthData: {},
      loadingSiblingHealth: null,
      // id -> { valid, error, pending } of the other products of the line, read in one request each when the tab is opened
      siblingStatus: {},
      siblingsLoaded: false,
      applyOpen: false,
      onlyDifferences: false,
    };
  },
  computed: {
    // a person who can only read the repository cannot generate or sync: the run would fail at its end, so it is off from the start
    lacksWrite() {
      const level = this.productData?.myLevel;
      return typeof level === 'number' && level < 30;
    },
    levelWord() {
      return this.$t(`labels.role${this.productData?.myLevel}`);
    },
    lineDeleted() {
      return Boolean(this.productData?.line?.deleted || this.preview?.lineDeleted);
    },
    // What would make a generation fail, from the same validation the health badge shows.
    generationIssues() {
      const issues = [];
      const health = this.healthData;
      if (health && !health.valid) issues.push(health.error || this.$t('labels.health_invalid_desc'));
      for (const m of this.badMetamodels) issues.push(`${m.title}: ${m.statusLabel}`);
      return issues;
    },
    // the metamodels whose model has errors: the product is not valid while one has them
    badMetamodels() {
      return this.metamodelSelectors.filter((m) => m.status === 'bad');
    },
    productValid() {
      return Boolean(this.healthData?.valid) && this.badMetamodels.length === 0;
    },
    invalidSummary() {
      if (this.healthData && !this.healthData.valid) return this.healthData.error || this.$t('labels.health_invalid_desc');
      return this.badMetamodels.map((m) => `${m.title}: ${m.statusLabel}`).join(' · ');
    },
    // the editor of the models (one engine for all of them) is made when the tab is opened, not before
    visitedMetamodel() {
      return Boolean(this.lastMetamodel) && Boolean(this.visitedTabs.models);
    },
    // the entries for the metamodels of the product's SPL: each has its own model (its feature selection, the feature metamodel's, among them)
    metamodelSelectors() {
      if (!this.modularOverview) return [];
      return this.modularOverview.metamodels.map((m) => {
        const state = this.modelStates[m.name];
        const errors = (state?.problems || []).filter((p) => p.severity === 'error').length;
        let status = 'unknown';
        let statusLabel = this.$t('modules.model_checking');
        // how it stands now (the editor's engine, once it runs) or, until then, how the server found it
        const known = state ? errors : m.errors;
        if (!(state ? state.text : m.model || '').trim()) {
          status = 'empty';
          statusLabel = this.$t('labels.model_empty');
        } else if (known !== undefined) {
          status = known ? 'bad' : 'ok';
          statusLabel = known ? this.$t('modules.model_errors', { n: known }) : this.$t('modules.model_valid');
        } else if (this.lineDeleted) {
          statusLabel = this.$t('modules.read_only');
        }
        return { id: `mm:${m.name}`, metamodel: m.name, title: m.name, key: m.extension, configured: true, status, statusLabel, pending: this.modelPending(m.name) };
      });
    },
    selectorModels() {
      return this.metamodelSelectors;
    },
    // the one open: the person's choice or, before one, the feature selection (what a product is, first of all)
    activeModelId() {
      return this.modelSubTab ?? (this.selectorModels.find((m) => m.metamodel === 'featureselection') ?? this.selectorModels[0])?.id ?? null;
    },
    // models the SPL no longer asks for and metamodels it gained that the product has no model of: found by the check as errors that
    // belong to no row of the list
    staleModels() {
      const known = new Set((this.modularOverview?.metamodels || []).map((m) => `.linea/models/${m.name}.${m.extension}`));
      const names = new Set();
      for (const d of this.modularOverview?.diagnostics || []) {
        if (d.severity !== 'error' || d.package !== 'product' || !d.file?.startsWith('.linea/models/')) continue;
        if (/is not a metamodel of this SPL/.test(d.message) || (/^There is no model of/.test(d.message) && known.has(d.file))) {
          names.add(d.file.replace(/^\.linea\/models\//, '').replace(/\.[^.]*$/, '').trim() || d.file);
        }
      }
      return [...names];
    },
    // the models of the product, one row each: its feature selection and the models of the other metamodels of its SPL
    modelRows() {
      return this.selectorModels.map((m) => {
        const info = this.modularOverview?.metamodels?.find((x) => x.name === m.metamodel);
        const lines = info?.model ? String(info.model).split('\n').filter((l) => l.trim()).length : 0;
        const parts = [this.$tc('labels.state_lines', lines, { n: lines })];
        if (m.metamodel === 'featureselection') parts.unshift(this.$t('labels.state_features', { n: this.selectedFeatures.length }));
        if (info?.requires?.length) parts.push(`${this.$t('labels.state_requires')} ${info.requires.join(', ')}`);
        return { id: m.id, title: m.title, key: m.key, status: m.status, statusLabel: m.statusLabel, pending: m.pending, info: parts.join(' · ') };
      });
    },
    // what the product has selected, as the summary names it
    selectedFeatures() {
      return [...new Set(this.productData?.spec?.features || [])];
    },
    // when the code was last deployed: the commit that recorded it, or the last one of the repository
    lastGenerationText() {
      const commits = this.activityData?.recentCommits || [];
      const found = commits.find((c) => /deployment|Generated new product version/i.test(c.message || '')) || this.activityData?.lastCommit;
      return found?.date ? this.timeAgo(found.date) : '';
    },
    // the version a generation would be by default
    nextGenerationVersion() {
      const deployed = this.productData?.deployment?.version ?? this.productData?.spec?.basicData?.version;
      return deployed ? bumpVersion(deployed, this.syncAutomation?.generation?.bump ?? 'patch') : '';
    },
    lastSyncRun() {
      return this.syncRuns.find((run) => run.status !== 'running') ?? null;
    },
    configText() {
      if (this.lineDeleted) return this.$t('modules.read_only');
      if (!this.productValid) return this.invalidSummary || this.$t('labels.migration_invalid');
      if (this.modelsOkCount) return this.$t('labels.state_models_ok', { n: this.modelsOkCount });
      return this.$t('labels.migration_valid');
    },
    pipelineFailed() {
      return ['failed', 'canceled'].includes(this.activityData?.lastPipeline?.status);
    },
    repoText() {
      const a = this.activityData;
      if (!a) return '';
      const parts = [this.$t('labels.state_open_mrs', { n: a.openMRs ?? 0 })];
      if (a.conflictingMRs > 0) parts.push(`${a.conflictingMRs} ${this.$t('labels.conflicts')}`);
      return parts.join(' · ');
    },
    recentVersions() {
      return (this.historyVersions || []).slice(0, 4);
    },
    modelsOkCount() {
      return this.selectorModels.filter(m => m.status === 'ok').length;
    },
    modelsBadCount() {
      return this.selectorModels.filter(m => m.status === 'bad').length;
    },
    activeSelectorModel() {
      return this.selectorModels.find(m => m.id === this.activeModelId) || {};
    },
    modelsPending() {
      if (this.lineDeleted || this.modelsFailed) return false;
      if (this.lineLoading || this.modelsLoading > 0 || !this.modularOverview) return true;
      return Boolean(this.activeSelectorModel.metamodel) && Boolean(this.modularOverview.summary);
    },
    activeModelText() {
      return this.modularOverview?.metamodels?.find((m) => m.name === this.activeSelectorModel.metamodel)?.model ?? '';
    },
    filteredSiblings() {
      return this.siblingProducts.filter(p => String(p._id) !== this.id);
    },
    // the most alike first: what a person looks for here is the product closest to this one
    sortedSiblings() {
      const rank = (s) => this.siblingDiff(s)?.similarity ?? -1;
      return [...this.filteredSiblings].sort((a, b) => rank(b) - rank(a) || String(a.name).localeCompare(String(b.name)));
    },
    applyTargets() {
      return this.filteredSiblings.map((sibling) => ({ ...sibling, features: this.siblingHealthData[String(sibling._id)]?.features }));
    },
    selectedSiblingForComparison() {
      if (!this.comparisonSiblingId) return null;
      return this.filteredSiblings.find(s => String(s._id) === this.comparisonSiblingId) || null;
    },
    comparisonData() {
      if (!this.comparisonSiblingId || !this.healthData) return null;
      const siblingHealth = this.siblingHealthData[this.comparisonSiblingId];
      if (!siblingHealth) return null;
      const currentSet = new Set(this.healthData.features || []);
      const siblingSet = new Set(siblingHealth.features || []);
      return {
        currentName: this.productData.spec?.basicData?.name || 'Current',
        siblingName: this.selectedSiblingForComparison?.name || 'Sibling',
        shared: [...currentSet].filter(f => siblingSet.has(f)),
        onlyInCurrent: [...currentSet].filter(f => !siblingSet.has(f)),
        onlyInSibling: [...siblingSet].filter(f => !currentSet.has(f)),
      };
    },
    // What can be taken out of the product, by what it comes from: the editor (when it has unsaved changes), what is saved and
    // what the last generation made.
    exportRows() {
      const rows = [];
      if (this.changes) {
        rows.push({
          key: 'editor', label: this.$t('generation.export_editor'),
          spec: () => this.exportJSON(), zip: () => this.generateZip(),
        });
      }
      const last = this.productData?.deployment;
      // what is saved only differs from the last generation when there are saved changes: otherwise it is the same thing twice
      const savedIsNew = !(last?.version && last.pending === false);
      if (savedIsNew) {
        rows.push({
          key: 'saved', label: this.$t('generation.export_saved'),
          spec: () => this.exportSavedSpec(), zip: () => this.zipSaved(),
        });
      }
      if (last?.version && last.pending !== null && last.pending !== undefined) {
        rows.push({
          key: 'version', label: this.$t('generation.export_last'), version: last.version,
          spec: () => this.exportVersionSpec(last.version), zip: () => this.zipVersion(last.version),
          specDisabled: !last.restorable,
        });
      }
      return rows;
    },
    // what can be compared: the versions that kept their snapshot (newest first) and what is saved now
    compareOptions() {
      return [
        { label: this.$t('generation.compare_saved'), value: SAVED },
        ...this.historyVersions.map((version) => ({ label: `v${version}`, value: version })),
      ];
    },
    deploymentRuns() {
      const version = this.deploymentVersion;
      if (!version) return [];
      return [pastRunOf({
        productId: this.id,
        name: this.productData?.spec?.basicData?.name ?? '',
        fromVersion: this.previousVersionOf(version) ?? '',
        version,
        logs: this.deploymentLogs,
        deployable: Boolean(this.productData?.repo) && hostRunsPipelines(this.productData?.gitHost || gitHosts.primary),
        // an older version is what happened; the last one still has its pipeline to follow
        historic: version !== this.productData?.spec?.basicData?.version,
        pipeline: this.versionPipelines[version] ?? null,
      })];
    },
    // the generation of this page as the dialog that tells it wants it: one run, in the same shape as the ones of a line
    generationRuns() {
      if (!this.generationPanel) return [];
      const failed = this.messages.at(-1)?.type === 'error' || this.messages.some((m) => m.type === 'error');
      let status = 'running';
      if (!this.loadingGenerationButton) {
        if (this.generationCancelled) status = 'cancelled';
        else if (failed || !this.generationResult) status = 'error';
        else status = this.generationResult.conflicts || this.generationResult.checksFailed || this.generationResult.checksDecision === 'reject' ? 'warning' : 'success';
      }
      return [{
        id: `${this.id}-${this.generationStartedAt?.getTime() ?? 0}`,
        productId: this.id,
        name: this.productData?.spec?.basicData?.name ?? '',
        fromVersion: this.generatingFrom,
        toVersion: this.generatingVersion,
        status,
        cancelling: this.generationCancelling,
        cancelRefused: this.generationCancelRefused,
        messages: this.messages,
        result: this.generationResult,
        deployable: Boolean(this.productData?.repo) && hostRunsPipelines(this.productData?.gitHost || gitHosts.primary),
        startedAt: this.generationStartedAt,
      }];
    },
    versionMenuItems() {
      const version = this.menuVersion;
      if (!version) return [];
      return [
        { label: this.$t('generation.version_changes_previous'), icon: 'pi pi-arrow-right-arrow-left', command: () => this.openVersionDiff(version, 'previous') },
        { label: this.$t('generation.version_changes_saved'), icon: 'pi pi-save', command: () => this.openVersionDiff(version, 'saved') },
        { label: this.$t('generation.version_compare_with'), icon: 'pi pi-clone', command: () => { this.compareFrom = version; this.compareTo = null; } },
      ];
    },
    // what the lists already say of this product: name, version, line and repository, until the product itself is read
    preview() {
      return (this.portfolioProducts || []).find((p) => String(p._id) === String(this.id)) || null;
    },
    gitlabInfo() {
      return this.productData?.repo || this.preview?.repo || null;
    },
    headLineId() {
      return this.productData?.lineId || this.preview?.lineId || null;
    },
    // the way out of a product: back to where it came from, or up to the SPL it belongs to
    backMenuItems() {
      const items = [{ label: this.$t('labels.go_back'), icon: 'pi pi-arrow-left', command: () => this.$router.go(-1) }];
      const lineId = this.headLineId;
      if (lineId && !this.lineDeleted) {
        const name = this.productData?.line?.name || this.preview?.line;
        items.push({
          label: name ? `${this.$t('labels.go_to_line')}: ${name}` : this.$t('labels.go_to_line'),
          icon: 'pi pi-sitemap',
          command: () => this.$router.push(`/lines/${lineId}`),
        });
      }
      return items;
    },
    testEnvImagePresetItems() {
      return [
        { label: this.$t('labels.docker_image_presets'), header: true },
        ...this.testEnvImagePresets.map(p => ({
          label: p.label,
          caption: p.caption,
          value: p.value,
          command: () => { this.store.basicData.testEnvironment.image = p.value; },
        })),
      ];
    },
  },
  watch: {
    id(newId, oldId) {
      if (newId === oldId) return;
      // what the progress card tells is about the product that was open, not this one
      if (!this.loadingGenerationButton) {
        this.generationPanel = false;
        this.messages = [];
      }
      this.reloadAll();
    },
    tab(newTab) {
      // the address says which tab is open, so the side bar (and a shared link) can point at it
      const query = this.$route?.query ?? {};
      if (this.$router && query.tab !== newTab) this.$router.replace({ query: { ...query, tab: newTab } });
      if (!this.visitedTabs[newTab]) this.visitedTabs = { ...this.visitedTabs, [newTab]: true };
      if (newTab === 'history' && !this.historyLoaded) this.loadHistoryVersions();
      if (newTab === 'history' && !this.pipelinesWanted) this.loadVersionPipelines();
      if (newTab === 'siblings') this.loadSiblingsOverview();
      // the overview only needs how each model stands; the editors need the grammars and what the modules offer
      if (newTab === 'models' && this.modularOverview?.summary) this.loadModularOverview({ full: true });
    },
    '$route.query.tab'(wanted) {
      if (wanted && String(wanted) !== this.tab) this.tab = String(wanted);
    },
    activeModelId(id) {
      const metamodel = this.metamodelSelectors.find((m) => m.id === id);
      if (metamodel) this.lastMetamodel = metamodel.metamodel;
    },
  },
  async mounted() {
    // whether this product's host runs pipelines (to follow one after a generation) is in what it says about the hosts
    loadGitHosts();
    window.addEventListener('keydown', this.onModelsKeydown);
    await this.reloadAll();
    // /products/:id?tab=models opens that tab (the old address of the models page redirects there)
    const wanted = this.$route && this.$route.query ? this.$route.query.tab : null;
    if (wanted) this.tab = String(wanted);
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.onModelsKeydown);
    socket.off('generation', this.onGenerationEvent);
    this.stopChangesPoll();
    clearTimeout(this.pipelinesTimer);
  },
  methods: {
    toggleBackMenu(evt) {
      // without the SPL known there is nothing to choose: it just goes back
      if (!this.headLineId) { this.$router.go(-1); return; }
      this.$refs.backMenu.toggle(evt);
    },
    toggleImagePresetsMenu(evt) { this.$refs.imagePresetsMenu.toggle(evt); },
    goToModel(modelId) {
      this.tab = 'models';
      this.modelSubTab = modelId;
    },
    toggleModelsExpanded() {
      this.modelsExpanded = !this.modelsExpanded;
      // the editors measure their box when they are made: they are asked to measure it again in the new one
      this.$nextTick(() => window.dispatchEvent(new Event('resize')));
    },
    onModelsKeydown(event) {
      if (event.key === 'Escape' && this.modelsExpanded) this.toggleModelsExpanded();
    },
    onModelStates({ states, dirty }) {
      this.modelStates = states;
      this.dirtyModels = dirty;
    },
    // a model was committed: the saved product is not what the last generation deployed any more, so the tag, the button and the
    // lists say so without waiting for a reload
    // whether what is saved of a model (a metamodel's name) is not in the deployed code yet
    modelPending(name) {
      const deployment = this.productData.deployment;
      if (deployment?.pending !== true) return false;
      // nothing generated yet: all of it is undeployed
      if (!deployment.version) return true;
      return (deployment.changedModels || []).includes(name);
    },
    async onModelsSaved(saved) {
      portfolioFreshness.stale();
      // the product's features are its feature selection's: the index follows the model that was saved
      if (Array.isArray(saved?.features)) {
        this.productData.spec = { ...this.productData.spec, features: [...saved.features] };
        store.features = [...saved.features];
        this.loadHealthData();
      }
      try {
        const answer = await productService.getProductsDeployments({ ids: [this.id] });
        if (answer?.[this.id]) this.productData.deployment = { ...this.productData.deployment, ...answer[this.id] };
      } catch {
        // the tag is a hint: it is right again with the next load
      }
    },
    // How the product syncs and generates (with what it inherits), and the syncs it has made.
    async loadSyncAutomation() {
      try {
        this.syncAutomation = await productService.getAutomation({ id: this.id });
      } catch {
        this.syncAutomation = null;
      }
    },
    async loadSyncs() {
      this.syncLoading = true;
      try {
        this.syncRuns = await productService.listSyncs({ id: this.id });
      } catch {
        this.syncRuns = [];
      } finally {
        this.syncLoading = false;
      }
    },
    // how generating and syncing are set up lives in the CI/CD tab
    openAutomation() {
      this.cicdMode = 'config';
      this.cicdKey += 1;
      this.tab = 'cicd';
    },
    // Puts the code back in line with the SPL. It does not change the version; what it does with a difference is the product's setting.
    // shows what the dependencies bring before syncing; the sync goes on when it is confirmed
    askSync() {
      if (this.syncing) return;
      this.syncPreview = true;
    },
    async runSync() {
      if (this.syncing) return;
      this.syncing = true;
      const finishRun = runStore.begin({ id: this.id, name: this.productData?.spec?.basicData?.name ?? '', lineName: this.productData?.line?.name ?? '' });
      try {
        const run = await productService.syncProduct({ id: this.id });
        const type = { failed: 'negative', skipped: 'warning', drift: 'warning', mr: 'warning' }[run.status] ?? 'positive';
        const features = (run.featuresAdded?.length || run.featuresRemoved?.length)
          ? ` ${this.$t('automation.done_features', { added: run.featuresAdded?.length ?? 0, removed: run.featuresRemoved?.length ?? 0 })}`
          : '';
        notify({ position: 'bottom-right', type, message: `${this.$t(`automation.done_${run.status}`, { n: run.files })}${features}` });
        // the SPL changed the features the product has: what the page shows of them is read again
        if (features) {
          store.clear();
          await this.getProductData();
          this.loadHealthData();
          this.loadModularOverview();
        }
      } catch (error) {
        const data = error.response?.data;
        const message = data?.error === 'error_messages.product_locked'
          ? this.$t('automation.busy', { kind: this.$t(`automation.busy_${data.kind ?? 'other'}`) })
          : this.$t(data?.error || 'error_messages.internal_error');
        notify({ position: 'bottom-right', type: 'negative', message });
      } finally {
        finishRun();
        this.syncing = false;
        this.loadSyncs();
        this.loadSyncAutomation();
        this.loadActivityData();
      }
    },
    async syncModels() {
      this.syncingModels = true;
      try {
        await productModelService.syncProductModels({ id: this.id });
        notify({ position: 'bottom-right', type: 'positive', message: this.$t('modules.models_synced') });
        await this.loadModularOverview({ full: true });
        this.modelsEditorKey = (this.modelsEditorKey || 0) + 1;
      } catch (e) {
        notify({ position: 'bottom-right', type: 'negative', message: this.$t(e.response?.data?.error || 'error_messages.internal_error') });
      } finally {
        this.syncingModels = false;
      }
    },
    async loadModularOverview({ full = false } = {}) {
      if (!full) this.modularOverview = null;
      // the models tab was opened already (a link to it, or a click before the summary came back): the editors need the whole answer
      const whole = full || Boolean(this.visitedTabs.models);
      this.modelsLoading += 1;
      this.modelsFailed = false;
      try {
        const overview = await productModelService.getProductModels({ id: this.id, summary: !whole });
        // a summary that arrives after the whole answer does not take its place
        if (overview.summary && this.modularOverview && !this.modularOverview.summary) return;
        this.modularOverview = overview;
        // the tab was opened while the summary was on its way
        if (overview.summary && this.visitedTabs.models) this.loadModularOverview({ full: true });
      } catch (e) {
        // the page was left while the answer was on its way: there is nobody to tell
        if (this.$.isUnmounted) return;
        this.modelsFailed = true;
        notify({ position: 'bottom-right', type: 'negative', message: this.$t(e.response?.data?.error || 'error_messages.internal_error') });
      } finally {
        this.modelsLoading = Math.max(0, this.modelsLoading - 1);
      }
    },
    pipelineWord,
    pipelineColorVar,

    async reloadAll() {
      store.clear();
      this.productLoading = false;
      this.productData = {};
      this.activityData = null;
      this.siblingProducts = [];
      this.lineLoading = false;
      this.lineAskedFor = null;
      this.healthData = null;
      this.historyVersions = [];
      this.historyLoaded = false;
      this.historyLogs = {};
      this.historyLogsLoading = {};
      this.expandedVersion = null;
      this.comparisonSiblingId = null;
      this.siblingHealthData = {};
      this.tab = 'overview';
      this.visitedTabs = { overview: true };
      this.modelSubTab = null;

      // health and activity need only the id: they are asked for while the product itself is read
      this.loadHealthData();
      this.loadActivityData({ early: true });
      // the history and the products of the SPL need only ids (the list of products knows the line): they go with the product
      this.loadLineData();
      this.loadHistoryVersions();
      this.loadSyncAutomation();
      this.loadSyncs();
      await this.getProductData();
      this.loadModularOverview();
      this.loadLineData();
      this.pipelinesWanted = false;
      clearTimeout(this.pipelinesTimer);
      this.pipelinesTimer = setTimeout(() => { if (!this.pipelinesWanted) this.loadVersionPipelines(); }, 3000);

      socket.off('generation', this.onGenerationEvent);
      socket.on('generation', this.onGenerationEvent);

      this.stopChangesPoll();
      this.changesPoll = setInterval(() => {
        if (document.hidden) return;
        this.changes = JSON.stringify(this.productData.spec) !== JSON.stringify(store.getSpec());
      }, 1000);
    },
    stopChangesPoll() {
      if (this.changesPoll) {
        clearInterval(this.changesPoll);
        this.changesPoll = null;
      }
    },
    onUpdateDecided(answer) {
      if (answer.deployment) this.productData.deployment = answer.deployment;
      this.loadActivityData();
      this.historyLoaded = false;
      if (this.tab === 'history') this.loadHistoryVersions();
    },
    onGenerationEvent(data) {
      if (data?.productId && String(data.productId) !== String(this.id)) return;
      this.messages.push(data);
    },

    async loadActivityData(options) {
      // `early`: asked for before the product is read, so it is not known yet whether it has a repository
      const early = options?.early === true;
      if (!early && !this.productData.repo) return;
      this.activityLoading = true;
      try {
        this.activityData = await productService.getProductActivity({ id: this.id });
      } catch (e) {
      } finally {
        this.activityLoading = false;
      }
    },

    async loadHealthData() {
      this.healthLoading = true;
      try {
        this.healthData = await productService.getProductHealth({ id: this.id });
      } catch (e) {
      } finally {
        this.healthLoading = false;
      }
    },

    // how another product of the line stands against this one: the features they differ in
    siblingDiff(sibling) {
      const current = this.healthData?.features;
      const other = this.siblingHealthData[String(sibling._id)]?.features;
      if (!current || !other) return null;
      const here = new Set(current);
      const there = new Set(other);
      const shared = [...here].filter((f) => there.has(f)).length;
      const onlyHere = here.size - shared;
      const onlyThere = there.size - shared;
      const union = shared + onlyHere + onlyThere;
      return { shared, onlyHere, onlyThere, similarity: union ? Math.round((shared / union) * 100) : 100 };
    },

    // validity, features and pending changes of the other products in one request each (not one request per product)
    async loadSiblingsOverview() {
      const ids = this.filteredSiblings.map((s) => String(s._id));
      if (this.siblingsLoaded || !ids.length) return;
      this.siblingsLoaded = true;
      const [statuses, deployments] = await Promise.allSettled([
        productService.getProductsStatus({ ids, features: true }),
        productService.getProductsDeployments({ ids }),
      ]);
      const next = {};
      for (const id of ids) {
        const health = statuses.status === 'fulfilled' ? statuses.value?.[id]?.health : null;
        next[id] = {
          valid: health ? health.valid : null,
          error: health?.error ?? '',
          pending: deployments.status === 'fulfilled' ? Boolean(deployments.value?.[id]?.pending) : false,
        };
      }
      this.siblingStatus = next;
      const found = { ...this.siblingHealthData };
      for (const id of ids) {
        if (found[id]) continue;
        const health = statuses.status === 'fulfilled' ? statuses.value?.[id]?.health : null;
        found[id] = { ...health, features: health?.features ?? [] };
      }
      this.siblingHealthData = found;
    },

    async onApplied(ids) {
      if (!ids.length) return;
      this.siblingsLoaded = false;
      this.siblingHealthData = {};
      this.siblingStatus = {};
      await this.loadSiblingsOverview();
    },

    async selectSiblingForComparison(sibling) {
      const siblingId = String(sibling._id);
      if (this.comparisonSiblingId === siblingId) {
        this.comparisonSiblingId = null;
        return;
      }
      this.comparisonSiblingId = siblingId;
      if (!this.siblingHealthData[siblingId]) {
        this.loadingSiblingHealth = siblingId;
        try {
          const health = await productService.getProductHealth({ id: siblingId });
          this.siblingHealthData = { ...this.siblingHealthData, [siblingId]: health };
        } catch (e) {
          this.siblingHealthData = { ...this.siblingHealthData, [siblingId]: { features: [] } };
        } finally {
          this.loadingSiblingHealth = null;
        }
      }
    },

    async loadHistoryVersions() {
      this.historyLoading = true;
      try {
        this.historyVersions = await logService.findVersions({ id: this.id });
        this.historyLoaded = true;
        // the pipeline each version had: best effort, the history does not wait for it
        if (this.pipelinesWanted) this.loadVersionPipelines();
      } catch (e) {
      } finally {
        this.historyLoading = false;
      }
    },
    // One call to the git host: asked for when the history is opened, or a few seconds after the page has what it came for.
    loadVersionPipelines() {
      this.pipelinesWanted = true;
      Promise.resolve().then(() => productService.getVersionPipelines({ id: this.id })).then((found) => { this.versionPipelines = found ?? {}; }).catch(() => {});
    },
    async toggleVersion(version) {
      if (this.expandedVersion === version) {
        this.expandedVersion = null;
        return;
      }
      this.expandedVersion = version;
      if (!this.historyLogs[version]) {
        this.historyLogsLoading = { ...this.historyLogsLoading, [version]: true };
        try {
          const logs = await logService.find({ id: this.id, version });
          this.historyLogs = { ...this.historyLogs, [version]: logs };
        } catch (e) {
          this.historyLogs = { ...this.historyLogs, [version]: [] };
        } finally {
          this.historyLogsLoading = { ...this.historyLogsLoading, [version]: false };
        }
      }
    },

    timeAgo(dateStr) {
      if (!dateStr) return '—';
      const secs = Math.floor((Date.now() - new Date(dateStr)) / 1000);
      if (secs < 60) return `${secs}s ago`;
      if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
      if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
      if (secs < 2592000) return `${Math.floor(secs / 86400)}d ago`;
      return new Date(dateStr).toLocaleDateString();
    },
    pipelineIcon(status) {
      const map = {
        success: 'pi pi-check-circle',
        failed:  'pi pi-times-circle',
        running: 'pi pi-play-circle',
        pending: 'pi pi-clock',
      };
      return map[status] || 'pi pi-question-circle';
    },

    async getProductData() {
      this.productLoading = true;
      this.loadError = '';
      try {
        this.productData = await productService.findProductById(this);
        this.productData.members = this.productData.members.map(m => ({
          ...m,
          role: `labels.role${m.role}`
        }));
        store.load(this.productData.spec);
        this.productData.spec = JSON.parse(JSON.stringify(store.getSpec()));
        this.importedSpec = null;
      } catch (error) {
        console.error('getProductData error:', error.response?.data || error);
        const message = error.response ? this.$t(error.response.data.error) : error.message;
        this.loadError = message || this.$t('error_messages.internal_error');
        notify({
          type: 'negative',
          message,
          position: 'bottom-right'
        });
      } finally {
        this.productLoading = false;
      }
    },

    async loadLineData() {
      const lineId = this.headLineId;
      if (!lineId || this.lineAskedFor === String(lineId)) return;
      this.lineAskedFor = String(lineId);
      this.lineLoading = true;
      try {
        const line = await lineService.findLineById({ id: lineId });
        this.siblingProducts = line.products || [];
      } catch (e) {
        this.lineAskedFor = null;
      } finally {
        this.lineLoading = false;
      }
    },
    // one of the models, in its own editor
    openModel(id) {
      this.tab = 'models';
      this.modelSubTab = id;
    },
    // what is wrong with this product is on its feature selection: that is where the chip goes, not to a check of the whole line
    openInvalidModel() {
      this.tab = 'models';
      const selection = this.selectorModels.find((m) => m.metamodel === 'featureselection');
      const featureSelectionBad = this.healthData && !this.healthData.valid;
      this.modelSubTab = (featureSelectionBad || !this.badMetamodels.length) && selection ? selection.id : (this.badMetamodels[0]?.id ?? null);
    },
    async openDiff() {
      this.diffOpen = true;
      this.diffLoading = true;
      this.diffData = null;
      try {
        this.diffData = await productService.getDeployment({ id: this.id });
      } catch (error) {
        this.diffOpen = false;
        notify({ type: 'negative', message: this.$t(error.response?.data?.error || 'error_messages.internal_error'), position: 'bottom-right' });
      } finally {
        this.diffLoading = false;
      }
    },
    // Throws away what was saved since the last generation: the spec goes back to the one that generation derived from.
    async discardSaved(parts = []) {
      this.discarding = true;
      try {
        const restored = await productService.discardSaved({ id: this.id, parts: Array.isArray(parts) ? parts : [] });
        this.applyRestored(restored);
        notify({ position: 'bottom-right', type: 'positive', message: this.$t('generation.discarded') });
        if (this.diffOpen) {
          // what is left to compare; the dialog closes by itself when nothing is
          if (restored.deployment?.pending === false) this.diffOpen = false;
          else this.diffData = await productService.getDeployment({ id: this.id }).catch(() => this.diffData);
        }
      } catch (error) {
        notify({ type: 'negative', message: this.$t(error.response?.data?.error || 'error_messages.internal_error'), position: 'bottom-right' });
      } finally {
        this.discarding = false;
      }
    },
    notifyUnsaved() {
      notify({ position: 'bottom-right', type: 'warning', message: this.$t('generation.unsaved') });
    },
    // `bump`: which part of the version this generation raises ('patch' when not given).
    async generateProduct(bump = 'patch') {
      let finishRun = () => {};
      try {
        if (this.hasUnsavedChanges() || this.dirtyModels.length) {
          this.notifyUnsaved();
        } else {
          this.loadingGenerationButton = true;
          this.messages = [];
          this.generationPanel = true;
          this.lastBump = bump;
          this.generationResult = null;
          this.generationCancelled = false;
          this.generationCancelling = false;
          this.generationCancelRefused = false;
          this.generationStartedAt = new Date();
          this.generationMinimized = false;
          this.generatingFrom = this.productData.spec.basicData.version;
          this.generatingVersion = bumpVersion(this.productData.spec.basicData.version, bump);
          finishRun = runStore.begin({ id: this.id, name: this.productData.spec.basicData.name, lineName: this.productData.line?.name ?? '', kind: 'generation' });
          const generation = await productService.generateProduct({ id: this.id, bump });
          if (generation.cancelled) {
            this.generationCancelled = true;
            notify({ position: 'bottom-right', type: 'info', message: this.$t('generation.cancelled_notice') });
            return;
          }
          this.productData.spec = generation.spec;
          store.load(this.productData.spec, true);
          this.productData.spec = JSON.parse(JSON.stringify(store.getSpec()));
          // Nothing to commit leaves the version where it was, not at the one that was asked for.
          this.generatingVersion = this.productData.spec.basicData.version;
          if (generation.deployment) this.productData.deployment = generation.deployment;
          this.loadSyncAutomation();
          this.generationResult = {
            changed: generation.changed, conflicts: Boolean(generation.conflicts), deployment: generation.deployment ?? null,
            checksFailed: generation.checksFailed ?? null, checksDecision: generation.checksDecision ?? null,
          };
          notify({
            position: 'bottom-right',
            type: generation.conflicts || generation.awaitingMerge || generation.checksFailed || generation.checksDecision ? 'warning' : (generation.changed === false ? 'info' : 'positive'),
            message: this.$t(
              generation.checksFailed
                ? (generation.checksFailed.status === 'timeout' ? 'generation.checks_unfinished' : 'generation.checks_not_passed')
                : generation.checksDecision
                ? `generation.checks_decided_${generation.checksDecision}`
                : generation.conflicts
                ? 'generation.conflicts'
                : (generation.awaitingMerge ? 'automation.awaiting_merge' : (generation.changed === false ? 'generation.up_to_date' : 'generation.no_conflicts'))
            )
          });
          this.loadActivityData();
          this.loadHealthData();
          this.historyLoaded = false;
          if (this.tab === 'history') this.loadHistoryVersions();
        }
      } catch (error) {
        const message = error.response?.data?.error || 'error_messages.internal_error';
        // The panel has to say it failed even when the server never got to emit an error event.
        if (this.generationPanel && this.messages.at(-1)?.type !== 'error') {
          this.messages.push({ type: 'error', message, createdAt: new Date() });
        }
        const told = this.messages.at(-1);
        notify({ type: 'negative', message: told?.type === 'error' ? this.$t(told.message, told.params) : this.$t(message), position: 'bottom-right' });
      } finally {
        finishRun();
        this.loadingGenerationButton = false;
      }
    },
    async cancelGeneration() {
      if (this.generationCancelling) return;
      this.generationCancelling = true;
      this.generationCancelRefused = false;
      try {
        const answer = await productService.cancelGeneration({ id: this.id });
        if (answer?.status !== 'cancelling') {
          this.generationCancelling = false;
          this.generationCancelRefused = answer?.status === 'committing';
        }
      } catch {
        this.generationCancelling = false;
      }
    },
    async deleteProduct(id) {
      try {
        this.deleteLoading = true;
        await productService.deleteProduct({ id });
        refreshPortfolio();
        this.$router.push('/');
      } catch (error) {
        notify({ type: 'negative', message: this.$t(error.response.data.error), position: 'bottom-right' });
      } finally {
        this.deleteLoading = false;
        this.selected = null;
      }
    },
    // What the editor holds against what is saved, read now: the poll only looks once a second (and not at all in a hidden tab), so a
    // change made just before saving or generating would still read as "no changes" and be skipped.
    hasUnsavedChanges() {
      this.changes = JSON.stringify(this.productData.spec) !== JSON.stringify(store.getSpec()) || Boolean(this.importedSpec);
      return this.changes;
    },
    async save() {
      this.savingProduct = true;
      try {
        // the models that are being edited are part of what this button saves
        if (this.dirtyModels.length) await this.$refs.modelsEditor?.save?.();
        if (this.hasUnsavedChanges()) {
          const importedSpec = this.importedSpec;
          const updated = await productService.updateSpec({ id: this.id, spec: store.getSpec(), importedSpec });
          this.importedSpec = null;
          this.productData.spec = updated.spec;
          if (updated.deployment) this.productData.deployment = updated.deployment;
          store.load(this.productData.spec, true);
          this.productData.spec = JSON.parse(JSON.stringify(store.getSpec()));
          this.changes = false;
          // what was saved may be what made the product valid (or not): the chip asks again
          this.loadHealthData();
          if (updated.modelImport && importedSpec) {
            this.modelImport = updated.modelImport;
            this.showModelImport = true;
            if (this.visitedTabs.models) this.reloadModels();
            else this.loadModularOverview();
          } else if (updated.modelImport?.updated?.length && this.visitedTabs.models) {
            this.reloadModels();
          }
          notify({
            position: 'bottom-right',
            message: this.$t(updated.deployment?.pending ? 'generation.saved_pending' : 'generation.saved'),
            type: 'positive'
          });
        }
      } catch (error) {
        // nothing was saved: what was edited is still unsaved
        this.changes = true;
        notify({
          position: 'bottom-right',
          message: this.$t(error.response?.data?.error || 'error_messages.internal_error'),
          type: 'negative'
        });
      } finally {
        this.savingProduct = false;
      }
    },
    // the name is changed on the product itself (its repository and its folder carry it), in the page of the rename
    renameProduct() {
      if (this.hasUnsavedChanges()) {
        this.notifyUnsaved();
        return;
      }
      this.$router.push(`/products/${this.id}/rename`);
    },
    startImportJSON() {
      this.$refs.hiddenUploader.click();
    },
    onHiddenUploaderChange(evt) {
      const file = evt.target.files && evt.target.files[0];
      if (!file) return;
      reader.onload = (event) => {
        // what the editor holds now: an import that does not fit leaves it as it was, not half loaded
        const before = JSON.parse(JSON.stringify(store.getSpec()));
        const refuse = () => {
          store.load(before, true);
          notify({ position: 'bottom-right', message: this.$t('error_messages.error_importing_cli_spec'), type: 'negative' });
          this.$refs.hiddenUploader.value = null;
        };
        try {
          const result = JSON.parse(event.target.result);
          const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
          const wellFormed = isObject(result) && !result.data
            && (result.basicData === undefined || isObject(result.basicData))
            && (result.features === undefined || (Array.isArray(result.features) && result.features.every((f) => typeof f === 'string')))
            && (result.statics === undefined || Array.isArray(result.statics))
            && (result.dataModel === undefined || isObject(result.dataModel));
          if (!wellFormed) return refuse();
          // the features of a product are its feature selection's (a model, edited in the models tab): a file cannot change them
          store.load({ ...result, features: before.features }, false);
          // the whole file goes to the models when the product is saved: the form keeps only what it edits
          this.importedSpec = result;
          notify({ position: 'bottom-right', message: this.$t('labels.specification_loaded'), type: 'positive' });
        } catch (error) {
          refuse();
        }
      };
      reader.readAsText(file);
    },
    exportJSON() {
      downloadJson(store.getSpec(), `${this.productData.spec.basicData.name}.json`);
    },
    async generateZip() {
      try {
        const zip = await productService.generateZip({ id: this.id, spec: store.getSpec() });
        downloadBlob(zip, `${this.productData.spec.basicData.name}.zip`);
      } catch (error) {
        notify({ type: 'negative', message: this.$t(error.response?.data?.error || 'error_messages.error_generating_zip'), position: 'bottom-right' });
      }
    },

    // ── what can be taken out: the saved spec and code, and those of a version ──────────────────────────────────────
    // one export at a time; a failure says what it was and leaves the rest as it was
    async runExport(key, task) {
      if (this.exporting) return;
      this.exporting = key;
      try {
        await task();
      } catch (error) {
        const code = error.response?.data?.error;
        notify({ type: 'negative', message: this.$t(code || 'error_messages.error_generating_zip'), position: 'bottom-right' });
      } finally {
        this.exporting = null;
      }
    },
    async exportSavedSpec() {
      const { saved } = await productService.getDeployment({ id: this.id });
      downloadJson(saved, `${saved.basicData.name}-saved.json`);
    },
    async exportVersionSpec(version) {
      const snapshot = await productService.getVersion({ id: this.id, version });
      downloadJson(snapshot.spec, `${snapshot.spec.basicData.name}-v${version}.json`);
    },
    async zipSaved() {
      const zip = await productService.generateZip({ id: this.id });
      downloadBlob(zip, `${this.productData.spec.basicData.name}-saved.zip`);
    },
    async zipVersion(version) {
      const zip = await productService.versionZip({ id: this.id, version });
      downloadBlob(zip, `${this.productData.spec.basicData.name}-v${version}.zip`);
    },

    // ── the history of versions: what each one changed, and going back to one ─────────────────────────────────────
    previousVersionOf(version) {
      return previousVersionIn(this.historyVersions, version);
    },
    // a version generated before every version kept its specification cannot be compared: say it is that one, not the last
    versionErrorMessage(error) {
      const code = error.response?.data?.error || 'error_messages.internal_error';
      return this.$t(code === 'error_messages.no_deployed_snapshot' ? 'generation.version_no_snapshot' : code);
    },
    openVersionMenu(event, version) {
      this.menuVersion = version;
      this.$nextTick(() => this.$refs.versionMenu?.toggle(event));
    },
    async openVersionDiff(version, against) {
      this.versionDiff = { ...LOADING_DIFF };
      try {
        const build = against === 'saved' ? diffVersionWithSaved : diffOfVersion;
        this.versionDiff = await build({ id: this.id, version, previous: this.previousVersionOf(version), t: (...args) => this.$t(...args) });
      } catch (error) {
        this.versionDiff = { ...this.versionDiff, open: false, loading: false };
        notify({ type: 'negative', message: this.versionErrorMessage(error), position: 'bottom-right' });
      }
    },
    // Any two points of the history: a version or what is saved now, one against the other.
    async compareSelected() {
      const { compareFrom: from, compareTo: to } = this;
      if (!from || !to || from === to) return;
      this.versionDiff = { ...LOADING_DIFF };
      try {
        this.versionDiff = await diffPoints({ id: this.id, from, to, savedPoint: SAVED, t: (...args) => this.$t(...args) });
      } catch (error) {
        this.versionDiff = { ...this.versionDiff, open: false, loading: false };
        notify({ type: 'negative', message: this.versionErrorMessage(error), position: 'bottom-right' });
      }
    },
    // Puts the spec and models of a version back as what is saved; says whether it could.
    async restoreTo(version) {
      this.restoring = true;
      try {
        this.applyRestored(await productService.restoreVersion({ id: this.id, version }));
        return true;
      } catch (error) {
        notify({ type: 'negative', message: this.$t(error.response?.data?.error || 'error_messages.internal_error'), position: 'bottom-right' });
        return false;
      } finally {
        this.restoring = false;
      }
    },
    // The first click arms it (it replaces what is saved), the second does it.
    async restoreVersion(version) {
      if (this.armedRestore !== version) {
        this.armedRestore = version;
        setTimeout(() => { if (this.armedRestore === version) this.armedRestore = null; }, 4000);
        return;
      }
      this.armedRestore = null;
      if (await this.restoreTo(version)) notify({ position: 'bottom-right', type: 'positive', message: this.$t('generation.version_restored', { version }) });
    },
    onResultVisible(open) {
      // closing the dialog of a run that is going keeps its card; closing a finished one dismisses it
      if (!open) {
        if (this.loadingGenerationButton) this.generationMinimized = true;
        else this.generationPanel = false;
      }
    },
    // how that version was deployed: what the generation did, what it changed against the one before, and its pipeline
    async openDeployment(version) {
      this.deploymentVersion = version;
      this.deploymentLogs = this.historyLogs[version] ?? [];
      this.deploymentOpen = true;
      if (!this.historyLogs[version]) {
        try {
          const logs = await logService.find({ id: this.id, version });
          this.historyLogs = { ...this.historyLogs, [version]: logs };
          if (this.deploymentVersion === version) this.deploymentLogs = logs;
        } catch (error) {
          this.deploymentLogs = [];
        }
      }
    },
    async rollbackFromVersion({ version }) {
      this.deploymentOpen = false;
      await this.rollbackGeneration({ version });
    },
    notifyError(code) {
      notify({ type: 'negative', message: this.$t(code), position: 'bottom-right' });
    },
    // Back to the version a generation started from: its spec and models are put back and generated again as a new version.
    async rollbackGeneration({ version }) {
      const leftVersion = this.productData?.spec?.basicData?.version;
      if (!(await this.restoreTo(version))) return;
      await this.generateProduct('patch');
      offerRollbackUndo({
        t: (key, args) => this.$t(key, args),
        leftVersion,
        restore: (v) => this.restoreTo(v),
        again: () => this.generateProduct('patch'),
      });
    },
    // What the page shows once the spec and models were put back to something else.
    applyRestored(restored) {
      this.productData.spec = restored.spec;
      store.load(this.productData.spec, true);
      this.productData.spec = JSON.parse(JSON.stringify(store.getSpec()));
      if (restored.deployment) this.productData.deployment = restored.deployment;
      this.loadHealthData();
      this.reloadModels();
    },
    // the models are read again and the editor is built anew: it holds the text it was given when it was made
    async reloadModels() {
      if (!this.visitedTabs.models) return;
      this.dirtyModels = [];
      await this.loadModularOverview({ full: true });
      this.modelsEditorKey += 1;
    },
  }
};
</script>

<style scoped lang="scss">
.page-root {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tab-panels-fill {
  flex: 1;
  min-height: 0;
  overflow: hidden;

  :deep(.p-tabpanels) {
    padding: 0;
    height: 100%;
    overflow: hidden;
    background: transparent;
  }

  :deep(.p-tabpanel) {
    height: 100%;
    overflow-y: auto;
  }
}

.detalle-cabecera {
  // The height of a row of buttons: the title with its tags and the buttons are centred on it, whatever the line below says.
  --cabecera-fila: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 20px 8px;

  &__volver {
    flex-shrink: 0;
    color: var(--p-text-muted-color);
    // the arrow is a little shorter than the row of buttons: it is centred on that row, not on its top
    margin-top: calc((var(--cabecera-fila) - 28px) / 2);
  }

  &__texto {
    flex-grow: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  &__title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    min-width: 0;
    min-height: var(--cabecera-fila);
  }

  &__title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 22px;
    font-weight: 300;
    // as tall as the row of buttons, so the first line of the title, its tags and the buttons share one middle
    line-height: var(--cabecera-fila);
    min-width: 0;
    overflow-wrap: anywhere;
    // the glyphs of this serif sit above the middle of their line box: they are brought down to the middle of the buttons' text
    position: relative;
    top: 3px;
  }

  &__meta {
    font-size: 14px;
    color: var(--p-text-muted-color);
  }

  &__estado {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
    padding: 3px 11px;
    border: 1px solid transparent;
    border-radius: 20px;
    background: transparent;
    font: inherit;
    font-size: 12px;
    line-height: 1.5;
    cursor: default;

    &--ok {
      color: var(--status-ok);
      background: var(--status-ok-soft);
      border-color: var(--status-ok-border);
    }

    &--mal {
      color: var(--status-bad);
      background: var(--status-bad-soft);
      border-color: var(--status-bad-border);
    }

    &--pulsable {
      cursor: pointer;

      &:hover { border-color: var(--status-bad); }
      &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 2px; }
    }
  }

  &__punto {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    background: currentColor;
  }

  &__actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--cabecera-fila);
  }

  &__borrar {
    color: var(--status-bad) !important;
  }
}

.detalle-cabecera__pasos {
  display: inline-flex;
  align-items: stretch;
  margin-left: 4px;

  // one control: the joined edges lose their radius, and the border of the save button is shared
  > :deep(.p-button),
  :deep(.generate-button .p-button) { border-radius: 0; }
  > :deep(.p-button:first-child) { border-radius: 8px 0 0 8px; }
  :deep(.generate-button:last-child .p-button) { border-radius: 0 8px 8px 0; }
  > :deep(.p-button:first-child) { border-right-width: 0; }
}

.export-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 20px;
}

.export-row {
  display: inline-flex;
  align-items: center;
  gap: 2px;

  &__label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

}

.chip-version {
  flex-shrink: 0;
  padding: 3px 9px;
  border-radius: 4px;
  background: var(--p-content-hover-background);
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--p-text-secondary-color);
}

.migas {
  flex-shrink: 0;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 36px;
  font-family: var(--font-mono);
  font-size: 12px;
  border-bottom: 1px solid var(--p-content-hover-background);

  &__item {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: var(--p-text-dim-color);
    cursor: pointer;

    &:hover { color: var(--p-text-color); }
  }

  &__sep {
    color: var(--p-text-faint-color);
  }

  &__current {
    color: var(--p-text-secondary-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

// narrow screens: the actions go under the title instead of squeezing it to a column of letters
@media (max-width: 800px) {
  .detalle-cabecera {
    flex-wrap: wrap;
    padding: 12px 16px 8px;

    &__texto { flex: 1 1 calc(100% - 52px); }
    &__actions { flex: 1 1 100%; flex-wrap: wrap; }
  }

  .detalle-pestanas {
    padding: 0 16px;

    :deep(.p-tablist) { max-width: 100%; }
  }
}

.detalle-pestanas {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0 24px;
  padding: 0 20px;
  border-bottom: 1px solid var(--p-content-border-color);

  :deep(.p-tablist) {
    background: transparent;
    border: none;
  }

  :deep(.p-tablist-tab-list) {
    background: transparent;
    border-bottom: none;
  }

  :deep(.p-tab) {
    margin-right: 20px;
    padding: 7px 0;
    background: transparent;
    border: none;
    font-size: 13px;
    text-transform: none;
    color: var(--p-text-muted-color);

    &:hover { color: var(--p-text-color); }
  }

  :deep(.p-tab-active) {
    color: var(--p-text-color);
    font-weight: 500;
  }

  :deep(.p-tablist-active-bar) {
    height: 2px;
    background: var(--p-primary-color);
  }
}
.panel-layout {
  display: flex;
  flex-direction: column;
}

.section-header__actions { margin-left: auto; display: inline-flex; gap: 4px; }
.comparison-panel__only { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--text-muted); cursor: pointer; }
.section-header {
  display: flex;
  align-items: center;
  gap: 6px;

  &--spaced { margin-bottom: 16px; }

  &--padded { padding: 0; }

  &__title {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-muted);
    flex: 1;
  }
}

.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--text-muted);

  &__text { font-size: 0.875rem; color: var(--text-muted); }
}

.panel-empty-text {
  font-size: 0.875rem;
  color: var(--text-muted);
  padding: 8px 0;
}

.details-layout {
  display: block;

  &__main {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-width: 0;
    padding: 18px 20px 28px;

    @media (max-width: 600px) {
      gap: 16px;
      padding: 16px 16px 32px;
    }
  }
}

.overview-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 24px;
  min-height: 36px;
  padding: 4px 10px;
  border: 1px solid var(--card-border);
  border-radius: 10px;
  background: var(--surface-alt);

  &__buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 0 4px; }
}

// how the product stands: four cells in one strip
.state {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid var(--card-border);
  border-radius: 10px;
  background: var(--card-bg);
  overflow: hidden;
  min-height: 64px;

  &--ghost { gap: 1px; background: transparent; border: 0; }

  &__cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 10px 14px;
    border: 0;
    border-left: 1px solid var(--card-border);
    background: none;
    font: inherit;
    color: inherit;
    text-align: left;

    &:first-child { border-left: 0; }
    &--action { cursor: pointer; &:hover { background: var(--p-content-hover-background); } }
    &--warn .state__value { color: var(--status-warn); }
    &--bad .state__value, &--bad .state__sub { color: var(--status-bad); }
    .state__resolve {
      background: none;
      border: 0;
      padding: 0;
      cursor: pointer;
      text-align: left;
      text-decoration: underline;
      color: var(--status-warn, inherit);
    }
  }

  &__label { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
  &__value { font-size: 1rem; font-weight: 600; color: var(--text-heading); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  &__sub { font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  &__links { display: flex; gap: 12px; }
  &__link {
    padding: 0;
    border: 0;
    background: none;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--p-primary-color);
    cursor: pointer;

    &:hover { text-decoration: underline; }
  }

  @media (max-width: 900px) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px 8px;
  border: 1px solid var(--card-border);
  border-radius: 10px;
  background: var(--card-bg);

  &__head { display: flex; align-items: center; gap: 12px; }
  &__title { font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-muted); }
  &__rule { flex-grow: 1; height: 1px; background: var(--card-border); }
  &__empty { margin: 0; font-size: 0.8125rem; color: var(--text-muted); }
}

.settings-fields { display: contents; }
.model-readonly { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.model-readonly__bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--p-text-muted-color); }
.model-readonly__tag { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--p-content-border-color); border-radius: 4px; padding: 1px 6px; }
.model-readonly__text { margin: 0; padding: 12px; font-size: 13px; line-height: 1.5; white-space: pre; overflow: auto; max-height: 70vh; border: 1px solid var(--p-content-border-color); border-radius: 8px; background: var(--p-content-hover-background); }
.model-stale { display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-bottom: 8px; border-radius: 6px; color: var(--p-warning-color, #f5a623); background: color-mix(in srgb, currentColor 10%, transparent); font-size: 13px; }
.model-stale span { flex: 1; color: var(--p-text-color); }
.model-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.model-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  border-top: 1px solid var(--card-border);
  font-size: 0.8125rem;

  &__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--p-text-faint-color);
    &--ok { background: var(--status-ok); }
    &--bad { background: var(--status-bad); }
    &--pending { background: var(--status-warn); }
  }
  &__name { font-weight: 600; color: var(--text-heading); }
  &__key { font-family: var(--font-mono); font-size: 0.6875rem; background: var(--code-bg); padding: 1px 5px; border-radius: 4px; color: var(--code-text); }
  &__status { font-size: 0.75rem; color: var(--text-muted);
    &--ok { color: var(--status-ok); }
    &--bad { color: var(--status-bad); }
  }
  &__info { font-size: 0.75rem; color: var(--text-muted); }
  &__spacer { flex-grow: 1; }
}
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip-feature {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.75rem;
  background: var(--surface-alt);
  border: 1px solid var(--card-border);
  color: var(--text-heading);
}
.chips__more { align-self: center; font-size: 0.75rem; color: var(--text-muted); }

.gens {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;

  &--ghost { gap: 4px; }
}
.gen {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  border-top: 1px solid var(--card-border);
  font-size: 0.8125rem;

  &__tag { font-size: 0.6875rem; color: var(--status-ok); font-weight: 600; }
  &__spacer { flex-grow: 1; }
  &__pipeline { font-size: 0.75rem; }
}

.tab-models {
  display: inline-flex;
  align-items: center;
  gap: 8px;

  &__count {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    font-weight: 600;

    i { font-size: 13px; }
    &--ok { color: var(--status-ok); }
    &--bad { color: var(--status-bad); }
  }
  &__count--ghost { visibility: hidden; }
}

.level-note { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 0.8rem; color: var(--text-muted); }

.members-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 4px;

  &__label    { font-size: 0.75rem; color: var(--text-muted); font-weight: 500; }
  &__avatars  { display: flex; align-items: center; }
  &__avatar   { border: 2px solid var(--avatar-border) !important; margin-left: -4px; cursor: default; &:first-child { margin-left: 0; } }
  &__overflow { font-size: 0.75rem; color: var(--text-muted); margin-left: 6px; font-weight: 500; }
}

.health-status {
  padding: 16px 36px;
  border-bottom: 1px solid var(--card-border);
  background: var(--card-bg);
  border-left: 4px solid transparent;

  &--valid   { border-left-color: var(--status-ok);  }
  &--invalid { border-left-color: var(--status-bad); }

  &__body  { display: flex; align-items: flex-start; gap: 4px; }
  &__text  { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  &__title { font-size: 1rem; font-weight: 600; }
  &__desc  { font-size: 0.8125rem; color: var(--text-muted); }
  &__chips { display: flex; flex-wrap: wrap; gap: 4px; }
  &__empty { padding: 8px 0; }
}

.health-error-box {
  margin-top: 6px;
  padding: 8px 12px;
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  border-radius: 6px;
  font-size: 0.8125rem;
  color: var(--error-text);
  font-family: var(--font-mono);
}

.health-section {
  padding: 16px 36px;
  border-bottom: 1px solid var(--card-border);
  background: var(--surface-alt);
}

.health-features {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.siblings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.sibling-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 10px;
  padding: 14px 16px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.15s, border-color 0.15s;
  display: flex;
  flex-direction: column;
  gap: 8px;

  &:hover       { box-shadow: 0 3px 8px rgba(0, 0, 0, 0.08); }
  &--active     { border-color: var(--p-primary-color); box-shadow: 0 0 0 2px var(--p-highlight-strong); }

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  &__name {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-heading);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__version { font-size: 0.6875rem; flex-shrink: 0; padding: 2px 6px; }
  &__meta    { font-size: 0.75rem; color: var(--text-muted); }
  &__actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  &__chips   { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-height: 20px; }
  &__diff    { display: flex; flex-direction: column; gap: 6px; }

  &__bar {
    height: 6px;
    border-radius: 3px;
    background: var(--status-neutral-solid);
    overflow: hidden;
  }
  &__bar-fill { display: block; height: 100%; background: var(--p-primary-color); }

  &__counts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 0.75rem;
    color: var(--text-muted);

    b { font-variant-numeric: tabular-nums; }
  }
  &__count--here  b { color: var(--p-primary-color); }
  &__count--there b { color: var(--p-format-xml-solid); }
}

.sibling-chip {
  font-size: 0.6875rem;
  padding: 1px 6px;
  color: var(--status-on-solid) !important;

  &--ok   { background: var(--status-ok) !important; }
  &--bad  { background: var(--status-bad) !important; }
  &--warn { background: var(--status-warn) !important; }
}

.comparison-panel {
  border: 1px solid var(--card-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--card-bg);

  &__header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: var(--surface-alt);
    border-bottom: 1px solid var(--card-border);
  }

  &__title {
    flex: 1;
    font-size: 0.8125rem;
    color: var(--text-heading);
  }
}

.comparison-loading {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 16px;
}

.comparison-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;

  @media (max-width: 700px) { grid-template-columns: 1fr; }
}

.comparison-col {
  padding: 14px 16px;
  border-right: 1px solid var(--card-border);

  &:last-child { border-right: none; }

  &__header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 10px;
    flex-wrap: wrap;
  }

  &__dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;

    &--current { background: var(--p-primary-color); }
    &--shared  { background: var(--p-text-muted-color); }
    &--sibling { background: var(--chart-3); }
  }

  &__chips { display: flex; flex-wrap: wrap; gap: 4px; }
  &__empty { font-size: 0.8125rem; color: var(--text-muted); }
}

.history-loading { padding: 0; }
.history-loading__row { margin-bottom: 4px; }

.models-layout-select {
  display: flex;
  flex-direction: column;
  height: calc(100% - 38px);
  margin: 18px 20px 20px;
  padding: 10px 14px;
  gap: 10px;
  border: 1px solid var(--tile-border);
  border-radius: 10px;
  background: var(--tile-bg);

  // fills the window, over the header and the tabs of the page
  &--expanded {
    position: fixed;
    inset: 0;
    z-index: 1100;
    height: auto;
    padding: 12px 20px;
    background: var(--p-content-background);

    .model-editor { display: flex; flex-direction: column; }
    :deep(.pme) { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    :deep(.pme__main) { flex: 1; min-height: 0; grid-template-rows: minmax(0, 1fr); align-items: stretch; }
    :deep(.workbench) { height: 100%; display: flex; flex-direction: column; }
    :deep(.workbench__host) { height: 100%; flex: 1; min-height: 0; }
  }
}

.model-selectors-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

// one row, however many metamodels there are: the rest is a scroll away
.model-selectors {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: thin;

  .model-selector { flex-shrink: 0; }
}

.model-selector-skeleton {
  border-radius: 6px;
}

.model-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  background: var(--p-content-background);
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--p-text-color);

  &--active {
    border-color: var(--p-primary-color);
    background: var(--p-highlight-soft);
  }

  &__dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--p-text-faint-color);

    &--ok { background: var(--status-ok); }
    &--bad { background: var(--status-bad); }
    &--empty { background: var(--status-warn); }
    &--pending { background: var(--status-warn); }
    &--unconfigured { background: var(--p-text-faint-color); }
    &--loading { background: var(--p-text-faint-color); }
  }

  &__body {
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  &__name {
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__status {
    font-size: 11px;
    color: var(--p-text-dim-color);
  }

  &__key {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--p-text-dim-color);
  }
}

.model-editor {
  flex: 1;
  min-height: 0;
}

.settings-col { display: flex; flex-direction: column; gap: 20px; min-width: 0; }

.test-env-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 4px;
}

.test-env-col {
  flex: 10000 1 0%;
  min-width: 0;
}

.test-env-field {
  display: block;

  :deep(.p-iconfield) {
    display: block;
    width: 100%;
  }
  :deep(.test-env-input) {
    width: 100%;
    padding-left: 30px;
  }

  &__preset-btn {
    color: var(--text-muted) !important;
    align-self: flex-start;
    margin-top: 6px;
  }
}

.test-env-preset-header {
  padding: 8px 12px 4px;
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 600;
}

.test-env-preset-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  text-decoration: none;
  color: inherit;

  &:hover { background: var(--surface-alt); }

  &__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  &__label {
    font-size: 0.875rem;
    color: var(--text-heading);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  &__caption {
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.slide-down-enter-active { transition: all 0.2s ease-out; }
.slide-down-leave-active { transition: all 0.15s ease-in; }
.slide-down-enter-from,
.slide-down-leave-to    { opacity: 0; transform: translateY(-6px); }

.quadrat { animation: save-badge-animation 1s infinite; }

@keyframes save-badge-animation {
  0%, 49%  { color: var(--p-primary-contrast-color); }
  50%, 100% { color: var(--status-warn-solid); }
}

.flex-shrink-0 { flex-shrink: 0; }

.danger-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 12px;
  border: 1px solid var(--status-bad-border);
  border-radius: 6px;
  background: var(--status-bad-soft);

  &__text {
    margin: 0;
    font-size: 0.8125rem;
  }
}

.config-caption {
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.4;
  letter-spacing: 0.02em;
}

.line-deleted-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px var(--space-5, 20px) 0;
  padding: 10px 14px;
  border: 1px solid var(--status-warn-border);
  border-radius: 8px;
  background: var(--status-warn-soft);
  color: var(--status-warn);
  font-size: 0.875rem;
}

.load-error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px var(--space-5, 20px) 0;
  padding: 10px 14px;
  border: 1px solid var(--p-red-500, #ef4444);
  border-radius: 8px;
  color: var(--p-red-400, #f87171);
}
.hidden-uploader {
  visibility: hidden;
  width: 0;
  height: 0;
  position: absolute;
}

.text-muted { color: var(--text-muted); }
.text-faint { color: var(--p-text-faint-color); }

.history-filter { display: inline-flex; gap: 6px; margin-inline-start: auto; }
.history-filter__pill { border: 1px solid var(--p-content-border-color); background: var(--card-bg); border-radius: 99px; padding: 2px 12px; font: inherit; font-size: 13px; color: var(--p-text-muted-color); cursor: pointer; }
.history-filter__pill--on { background: var(--p-highlight-background); color: var(--p-primary-color); border-color: transparent; font-weight: 600; }
.history-filter__pill--on.history-filter__pill--sync { background: var(--sync-soft); color: var(--sync); }
</style>
