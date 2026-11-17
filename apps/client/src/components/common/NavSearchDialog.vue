<script setup>
import { shallowRef, ref, computed, watch, nextTick, getCurrentInstance, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import packageService from 'src/services/packageService'
import productService from 'src/services/productService'
import schedulerService from 'src/services/schedulerService'
import settingsService from 'src/services/settingsService'
import pluginService from 'src/services/pluginService'
import generationStore from 'stores/generationStore'
import runStore from 'stores/runStore'
import { appDialogs } from 'stores/appDialogs'
import { notify, errorMessage } from 'src/composables/useNotify'
import { useSignOut } from 'src/composables/useSignOut'
import { downloadBlob } from 'src/utils/download'
import { rememberLanguageUndo } from 'src/utils/paletteUndo'
import { SHORTCUTS, matchShortcut, isBusy, webUrlOf, productActions, accountActions, contextActions, routeContext } from 'src/utils/paletteActions'
import GeneratePreviewDialog from 'components/generation/GeneratePreviewDialog.vue'
import { sections } from 'components/settings/sections'
import { state } from 'stores/userState'
import { useTheme } from 'src/composables/useTheme'
import { useT } from 'src/composables/useT'
import { usePortfolio, ensureStatuses, healthOf, hasPendingChanges, lineHealth, lineLastSync } from 'src/composables/usePortfolio'
import { LANGUAGES, i18n, setLocale } from 'src/boot/i18n'
import { searchEntries, countByGroup, highlightParts, readRecent, rememberRecent, readUsage, recordUsage, readPinned, togglePinned, PINNED_MAX, GROUP_ORDER } from 'src/utils/commandPalette'
import { relativeShort } from 'src/utils/relativeTime'
import PrimeDialog from 'primevue/dialog'
import PrimeButton from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])

const router = useRouter()
const route = useRoute()
const signOut = useSignOut()
const t = useT()
const instance = getCurrentInstance()
const { isDark, toggleTheme } = useTheme()
const { lines, products } = usePortfolio({ statuses: false })

const query = shallowRef('')
const modules = ref([])
const metamodels = ref([])
const packagesLoaded = shallowRef(false)
const loading = shallowRef(false)
const inputRef = ref(null)
const active = shallowRef(0)
const recent = ref([])
const filter = shallowRef(null)
const usage = ref(readUsage())
const pinned = ref(readPinned())
const schedulerPaused = shallowRef(null)
const generateTargets = ref([])
const generateOpen = shallowRef(false)

const lineName = (product) => (typeof product.line === 'string' ? product.line : product.line?.name)
const safe = async (promise) => {
  try {
    return await promise
  } catch {
    return []
  }
}
const locale = () => instance?.proxy?.$i18n?.locale

const loadScheduler = async () => {
  try {
    schedulerPaused.value = Boolean((await schedulerService.status()).paused)
  } catch {
    schedulerPaused.value = null
  }
}

const toggleScheduler = async (paused) => {
  try {
    await settingsService.saveInstance({ schedulerPaused: paused })
    schedulerPaused.value = paused
    notify({ type: 'positive', message: t(paused ? 'palette.scheduler_paused' : 'palette.scheduler_resumed') })
  } catch (error) {
    notify({ type: 'negative', message: errorMessage(error, t) })
  }
}

const downloadConfig = async () => {
  try {
    downloadBlob(new Blob([await pluginService.exportConfig()], { type: 'text/yaml' }), 'linea.config.yml')
  } catch (error) {
    notify({ type: 'negative', message: errorMessage(error, t) })
  }
}

const SYNC_TONE = { failed: 'negative', skipped: 'warning', drift: 'warning', mr: 'warning' }

const runSync = async (product) => {
  const finish = runStore.begin({ id: product._id, name: product.name, lineName: lineName(product) ?? '' })
  const link = { label: t('palette.see_run'), handler: () => router.push(`/cicd?productId=${product._id}`) }
  try {
    const run = await productService.syncProduct({ id: product._id })
    notify({ type: SYNC_TONE[run.status] ?? 'positive', message: `${product.name}: ${t(`automation.done_${run.status}`, { n: run.files })}`, action: link })
  } catch (error) {
    const data = error.response?.data
    const message = data?.error === 'error_messages.product_locked'
      ? t('automation.busy', { kind: t(`automation.busy_${data.kind ?? 'other'}`) })
      : t(data?.error || 'error_messages.internal_error')
    notify({ type: 'negative', message: `${product.name}: ${message}` })
  } finally {
    finish()
  }
}

const copyAddress = async (product) => {
  const address = `${webUrlOf(product)}.git`
  try {
    await navigator.clipboard.writeText(address)
    notify({ type: 'positive', message: t('labels.git_url_copied') })
  } catch {
    notify({ type: 'negative', message: address })
  }
}

const askGeneration = (list) => {
  generateTargets.value = list.map((product) => ({ id: product._id, name: product.name, version: product.version }))
  generateOpen.value = true
}

const startGeneration = (items) => {
  const byId = new Map((products.value ?? []).map((product) => [String(product._id), product]))
  generationStore.enqueue(items.map((item) => {
    const product = byId.get(String(item.id))
    return { _id: item.id, name: item.name, lineId: product?.lineId, lineName: lineName(product ?? {}), bump: item.bump, version: product?.version, deployable: true }
  }))
  const single = items.length === 1 ? items[0] : null
  notify({
    type: 'positive',
    message: single ? t('palette.generating_one', { name: single.name }) : t('products_bulk.generating', { n: items.length }),
    action: { label: t('palette.see_run'), handler: () => router.push(single ? `/cicd?productId=${single.id}` : '/cicd') },
  })
}

const withUndo = (message, undo) => notify({ type: 'positive', timeout: 10000, message, action: { label: t('palette.undo'), handler: undo } })

const changeTheme = () => {
  toggleTheme()
  withUndo(t('palette.theme_changed'), toggleTheme)
}

const changeLanguage = (code) => {
  rememberLanguageUndo(i18n.global.locale)
  setLocale(code)
}

const clickKey = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key }))

const context = computed(() => routeContext(route.path))
const contextLine = computed(() => {
  if (context.value?.kind !== 'line') return null
  return (lines.value ?? []).find((line) => String(line._id) === context.value.id) ?? null
})
const contextProduct = computed(() => {
  if (context.value?.kind !== 'product') return null
  return (products.value ?? []).find((product) => String(product._id) === context.value.id) ?? null
})
const pendingProducts = computed(() => (products.value ?? []).filter((product) => !product.lineDeleted
  && hasPendingChanges(product)
  && !isBusy(product._id, { runs: runStore.runs, jobs: generationStore.jobs })
  && (!contextLine.value || String(product.lineId) === String(contextLine.value._id))))

const productHandlers = { generate: (product) => askGeneration([product]), sync: runSync, copyAddress, openHost: (product) => window.open(webUrlOf(product), '_blank', 'noopener') }

const quickActionsOf = (product) => productActions({
  product,
  t,
  busy: isBusy(product._id, { runs: runStore.runs, jobs: generationStore.jobs }),
  lastOutcome: healthOf(product).lastGeneration?.outcome ?? null,
  handlers: productHandlers,
})

const productActionEntries = computed(() => {
  const asked = String(query.value).trim()
  if (!asked.startsWith('>') || !asked.slice(1).trim()) return []
  return (products.value ?? []).flatMap(quickActionsOf)
})

watch(() => props.modelValue, async (open) => {
  if (!open) return
  query.value = ''
  active.value = 0
  filter.value = null
  recent.value = readRecent()
  usage.value = readUsage()
  pinned.value = readPinned()
  ensureStatuses()
  if (state.user?.admin) loadScheduler()
  await nextTick()
  inputRef.value?.focus()
  if (packagesLoaded.value) return
  loading.value = true
  try {
    const [moduleList, metamodelList] = await Promise.all([
      safe(packageService.list({ kind: 'module' })),
      safe(packageService.list({ kind: 'metamodel' })),
    ])
    modules.value = moduleList
    metamodels.value = metamodelList
    packagesLoaded.value = true
  } finally {
    loading.value = false
  }
})

const packageEntries = (items, group, base) => items
  .filter((pkg) => !pkg.unavailable && !pkg.readOnly)
  .map((pkg) => ({
    id: `${group}:${pkg.id}`,
    group,
    title: pkg.name,
    caption: pkg.latest ? `v${pkg.latest}` : (pkg.path ?? ''),
    keywords: [pkg.path, pkg.description],
    icon: group === 'modules' ? 'pi-th-large' : 'pi-sitemap',
    to: `${base}/${pkg.id}`,
    package: pkg,
  }))

const entries = computed(() => {
  const pages = [
    { id: 'page:dashboard', title: t('labels.dashboard'), to: '/', icon: 'pi-home' },
    { id: 'page:lines', title: t('labels.lines'), to: '/lines', icon: 'pi-folder-open' },
    { id: 'page:products', title: t('labels.products'), to: '/products', icon: 'pi-box' },
    { id: 'page:cicd', title: t('labels.tab_cicd'), to: '/cicd', icon: 'pi-cloud' },
    { id: 'page:modules', title: t('modules.nav'), to: '/packages/modules', icon: 'pi-th-large' },
    { id: 'page:metamodels', title: t('modules.nav_metamodels'), to: '/packages/metamodels', icon: 'pi-sitemap' },
    ...(state.user?.admin
      ? sections.map((section) => ({
        id: `page:settings-${section.key}`,
        title: `${t('configuration.nav')} → ${t(section.labelKey)}`,
        to: `/settings/${section.key}`,
        icon: section.icon,
        keywords: ['settings', 'configuration'],
      }))
      : []),
  ].map((page) => ({ caption: t('palette.hint_page'), effect: t('palette.effect_page', { path: page.to }), ...page, group: 'pages' }))

  const actions = [
    { id: 'action:create-line', title: t('labels.spl_add'), caption: t('palette.hint_create_line'), icon: 'pi-plus', to: '/add', effect: t('palette.effect_create_line'), keywords: ['new', 'add', 'line', 'spl'] },
    {
      id: 'action:theme',
      title: t('labels.toggle_theme'),
      caption: t('palette.hint_theme'),
      icon: isDark.value ? 'pi-sun' : 'pi-moon',
      run: changeTheme,
      badge: isDark.value ? t('palette.dark') : t('palette.light'),
      effect: isDark.value ? t('palette.effect_theme_light') : t('palette.effect_theme_dark'),
      keywords: ['dark', 'light'],
    },
    { id: 'action:sidebar', title: t('palette.act_sidebar'), caption: t('palette.hint_sidebar'), icon: 'pi-align-left', run: () => clickKey('['), keywords: ['sidebar', 'explorer', 'collapse'] },
    { id: 'action:sidebar-filter', title: t('palette.act_sidebar_filter'), caption: t('palette.hint_sidebar_filter'), icon: 'pi-filter', run: () => clickKey('/'), keywords: ['sidebar', 'explorer', 'filter'] },
    ...LANGUAGES.map((lang) => ({
      id: `action:language-${lang.code}`,
      title: `${t('labels.language')}: ${lang.name}`,
      caption: t('palette.hint_language'),
      icon: 'pi-globe',
      run: () => changeLanguage(lang.code),
      badge: lang.code === i18n.global.locale ? t('palette.current') : null,
      effect: t('palette.effect_language', { name: lang.name }),
      keywords: ['language', 'idioma'],
    })),
    ...accountActions({
      t,
      isAdmin: Boolean(state.user?.admin),
      hasLocalAccount: state.user?.hosts?.[0] === 'local',
      schedulerPaused: schedulerPaused.value,
      handlers: {
        signOut,
        account: () => { appDialogs.account = true },
        sessions: () => { appDialogs.sessions = true },
        toggleScheduler,
        downloadConfig,
      },
    }),
    ...contextActions({
      t,
      line: contextLine.value,
      product: contextProduct.value,
      pending: pendingProducts.value,
      handlers: { generatePending: askGeneration },
    }),
    ...productActionEntries.value,
  ].map((action) => ({ ...action, shortcut: SHORTCUTS[action.id]?.label ?? null, group: 'actions' }))

  return [
    ...actions,
    ...pages,
    ...(lines.value ?? []).map((line) => ({
      id: `line:${line._id}`, group: 'lines', title: line.name, caption: `v${line.version}`, icon: 'pi-building', to: `/lines/${line._id}`, line,
    })),
    ...(products.value ?? []).map((product) => ({
      id: `product:${product._id}`,
      group: 'products',
      title: product.name,
      caption: [lineName(product), product.lineDeleted ? t('labels.product_unmaintained') : null].filter(Boolean).join(' · '),
      icon: 'pi-box',
      to: `/products/${product._id}`,
      product,
    })),
    ...packageEntries(modules.value, 'modules', '/packages/modules'),
    ...packageEntries(metamodels.value, 'metamodels', '/packages/metamodels'),
  ]
})

const everything = computed(() => searchEntries(entries.value, query.value, { recent: recent.value, pinned: pinned.value, usage: usage.value, perGroup: 1000 }))
const counts = computed(() => countByGroup(everything.value))
const chips = computed(() => GROUP_ORDER.filter((group) => group !== 'recent' && group !== 'pinned' && counts.value[group]))
const activeFilter = computed(() => (filter.value && chips.value.includes(filter.value) ? filter.value : null))
const results = computed(() => searchEntries(entries.value, query.value, {
  recent: recent.value,
  pinned: pinned.value,
  usage: usage.value,
  groups: activeFilter.value ? [activeFilter.value] : null,
  perGroup: activeFilter.value ? 30 : 5,
}))

const rows = computed(() => {
  const out = []
  let last = null
  results.value.forEach((entry, index) => {
    if (entry.group !== last) {
      out.push({ header: entry.group })
      last = entry.group
    }
    out.push({ entry, index })
  })
  return out
})

watch([query, filter], () => { active.value = 0 })

const close = () => emit('update:modelValue', false)
const clearQuery = () => {
  query.value = ''
  inputRef.value?.focus()
}

const go = (target) => {
  if (!target) return
  if (target.group && !target.transient) recent.value = rememberRecent(target.id)
  const usageKey = target.usageKey ?? (target.group ? target.id : null)
  if (usageKey) usage.value = recordUsage(usageKey)
  close()
  if (target.run) target.run()
  else router.push(target.to)
}

const move = (step) => {
  const count = results.value.length
  if (!count) return
  active.value = (active.value + step + count) % count
  nextTick(() => document.getElementById(`search-option-${active.value}`)?.scrollIntoView({ block: 'nearest' }))
}

const cycleFilter = (step) => {
  const options = [null, ...chips.value]
  const next = (options.indexOf(activeFilter.value) + step + options.length) % options.length
  filter.value = options[next]
}

const current = computed(() => results.value[active.value] ?? null)

const TONES = { ok: 'ok', bad: 'bad', checking: 'wait' }
const GENERATION_LABEL = { success: 'palette.generation_success', warning: 'palette.generation_warning', error: 'palette.generation_error', cancelled: 'palette.generation_cancelled' }
const GENERATION_TONE = { success: 'ok', warning: 'warn', error: 'bad', cancelled: 'warn' }

const productFacts = (entry) => {
  const product = entry.product
  const health = healthOf(product)
  const facts = [
    { label: t('labels.line'), value: lineName(product) },
    { label: t('labels.version'), value: `v${product.version}` },
    { label: t('generation.changes'), value: hasPendingChanges(product) ? t('palette.changes_pending') : t('palette.changes_none'), tone: hasPendingChanges(product) ? 'warn' : null },
  ]
  const generation = health.lastGeneration
  facts.push({
    label: t('palette.last_generation'),
    value: generation ? `${t(GENERATION_LABEL[generation.outcome] ?? GENERATION_LABEL.success)} · ${relativeShort(generation.at, locale())}` : t('palette.never_generated'),
    tone: generation ? GENERATION_TONE[generation.outcome] : null,
  })
  return {
    status: health.status,
    statusText: health.status === 'ok' ? t('labels.healthy') : health.status === 'bad' ? t('labels.needs_attention') : t('palette.checking'),
    reasons: health.reasons.map((reason) => t(`labels.health_reason_${reason}`)),
    facts,
    actions: [
      ...quickActionsOf(product),
      { id: 'link:product-cicd', label: t('labels.tab_cicd'), icon: 'pi-cloud', to: `/products/${product._id}?tab=cicd` },
    ],
  }
}

const lineFacts = (entry) => {
  const line = entry.line
  const summary = lineHealth(line)
  const sync = lineLastSync(line)
  const status = summary.bad > 0 ? 'bad' : summary.checking > 0 || summary.total === 0 ? 'checking' : 'ok'
  return {
    status: summary.total ? status : null,
    statusText: status === 'ok' ? t('labels.healthy') : status === 'bad' ? t('labels.needs_attention') : t('palette.checking'),
    reasons: [],
    summary,
    facts: [
      { label: t('labels.version'), value: `v${line.version}` },
      { label: t('labels.products'), value: String(summary.total) },
      { label: t('labels.last_sync'), value: sync === null ? t('palette.never') : relativeShort(new Date(sync).toISOString(), locale()) },
    ],
    actions: [
      { id: 'link:line-cicd', label: t('labels.tab_cicd'), icon: 'pi-cloud', to: `/lines/${line._id}?tab=cicd` },
      { id: 'link:line-modules', label: t('modules.nav'), icon: 'pi-th-large', to: `/lines/${line._id}/modules` },
    ],
  }
}

const packageFacts = (entry) => {
  const pkg = entry.package
  return {
    status: null,
    reasons: [],
    description: pkg.description,
    facts: [
      { label: t('labels.version'), value: pkg.latest ? `v${pkg.latest}` : t('modules.unpublished') },
      { label: t('palette.versions'), value: String(pkg.versions?.length ?? 0) },
      { label: t('palette.location'), value: pkg.path, mono: true },
    ],
    actions: [],
  }
}

const preview = computed(() => {
  const entry = current.value
  if (!entry) return null
  const base = { entry, status: null, reasons: [], facts: [], actions: [], description: entry.caption }
  if (entry.product) return { ...base, ...productFacts(entry), description: null }
  if (entry.line) return { ...base, ...lineFacts(entry), description: null }
  if (entry.package) return { ...base, ...packageFacts(entry) }
  return { ...base, description: entry.caption, facts: entry.effect ? [{ label: t('palette.effect'), value: entry.effect }] : [], statusText: entry.badge ?? null, badge: entry.badge ?? null }
})

const onEnter = (event) => {
  if ((event.ctrlKey || event.metaKey) && preview.value?.actions[0]) go(preview.value.actions[0])
  else go(current.value)
}

const groupLabel = (group) => ({
  pinned: t('palette.pinned'),
  recent: t('labels.search_recent'),
  actions: t('labels.search_actions'),
  pages: t('labels.search_pages'),
  lines: t('labels.lines'),
  products: t('labels.products'),
  modules: t('modules.nav'),
  metamodels: t('modules.nav_metamodels'),
})[group] ?? group

const ICONS = { pinned: 'pi-bookmark', recent: 'pi-history', lines: 'pi-building', products: 'pi-box', modules: 'pi-th-large', metamodels: 'pi-sitemap', pages: 'pi-compass', actions: 'pi-bolt' }
const kindOf = (entry) => entry.origin ?? entry.group
const iconOf = (entry) => entry.icon ?? ICONS[kindOf(entry)]
const isPinned = (entry) => pinned.value.includes(entry.id)

const pinEntry = (entry) => {
  const result = togglePinned(entry.id)
  pinned.value = result.pinned
  if (result.full) notify({ type: 'warning', message: t('palette.pin_full', { n: PINNED_MAX }) })
}

const GLOBAL_SHORTCUTS = { 'action:theme': changeTheme }

const onShortcut = (event) => {
  const id = Object.keys(GLOBAL_SHORTCUTS).find((key) => SHORTCUTS[key].global && matchShortcut(event, SHORTCUTS[key]))
  if (!id) return
  event.preventDefault()
  usage.value = recordUsage(id)
  GLOBAL_SHORTCUTS[id]()
}

onMounted(() => window.addEventListener('keydown', onShortcut))
onBeforeUnmount(() => window.removeEventListener('keydown', onShortcut))

const dotOf = (entry) => {
  if (entry.product) return TONES[healthOf(entry.product).status]
  if (entry.line) {
    const summary = lineHealth(entry.line)
    return summary.total ? (summary.bad > 0 ? 'bad' : summary.checking > 0 ? 'wait' : 'ok') : null
  }
  return null
}
</script>

<template>
  <PrimeDialog
    :visible="modelValue"
    modal
    :show-header="false"
    :closable="false"
    :close-on-escape="true"
    dismissable-mask
    class="search-dialog"
    style="width: 880px; max-width: 94vw"
    :pt="{ content: { style: 'padding: 0; border-radius: 12px; overflow: hidden' } }"
    @update:visible="$emit('update:modelValue', $event)"
  >
    <div class="palette">
      <div class="palette__header">
        <i class="pi pi-search palette__lens" aria-hidden="true" />
        <input
          ref="inputRef"
          v-model="query"
          class="palette__input"
          role="combobox"
          aria-expanded="true"
          aria-controls="search-listbox"
          :aria-activedescendant="results.length ? `search-option-${active}` : undefined"
          :aria-label="$t('labels.search_placeholder')"
          :placeholder="$t('labels.search_placeholder')"
          autocomplete="off"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.tab.exact.prevent="cycleFilter(1)"
          @keydown.shift.tab.prevent="cycleFilter(-1)"
          @keydown.enter.prevent="onEnter"
          @keydown.escape="close"
        />
        <ProgressSpinner v-if="loading" class="palette__spinner" stroke-width="6" />
        <button v-else-if="query" type="button" class="palette__clear" :aria-label="$t('error_state.search')" @click="clearQuery">
          <i class="pi pi-times" aria-hidden="true" />
        </button>
        <kbd class="palette__kbd">esc</kbd>
      </div>

      <div v-if="chips.length" class="palette__chips" role="group" :aria-label="$t('palette.filter')">
        <button type="button" class="palette__chip" :class="{ 'palette__chip--on': !activeFilter }" @click="filter = null">
          {{ $t('palette.all') }}
        </button>
        <button
          v-for="group in chips"
          :key="group"
          type="button"
          class="palette__chip"
          :class="{ 'palette__chip--on': activeFilter === group }"
          @click="filter = filter === group ? null : group"
        >
          <i class="pi" :class="ICONS[group]" aria-hidden="true" />
          {{ groupLabel(group) }}
          <span class="palette__count">{{ counts[group] }}</span>
        </button>
      </div>

      <div class="palette__body">
        <div class="palette__list">
          <div v-if="results.length" id="search-listbox" role="listbox">
            <template v-for="row in rows" :key="row.header ?? row.entry.group + row.entry.id">
              <div v-if="row.header" class="palette__group" role="presentation">{{ groupLabel(row.header) }}</div>
              <a
                v-else
                :id="`search-option-${row.index}`"
                role="option"
                class="palette__item"
                :class="{ 'palette__item--active': row.index === active }"
                :aria-selected="row.index === active"
                @mousemove="active = row.index"
                @click="go(row.entry)"
              >
                <span class="palette__tile" :class="`palette__tile--${kindOf(row.entry)}`">
                  <i class="pi" :class="iconOf(row.entry)" aria-hidden="true" />
                </span>
                <span class="palette__text">
                  <span class="palette__title">
                    <template v-for="(part, i) in highlightParts(row.entry.title, query)" :key="i"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
                  </span>
                  <span v-if="row.entry.caption" class="palette__caption">{{ row.entry.caption }}</span>
                </span>
                <span v-if="dotOf(row.entry)" class="palette__dot" :class="`palette__dot--${dotOf(row.entry)}`" aria-hidden="true" />
                <span v-if="row.entry.badge" class="palette__badge">{{ row.entry.badge }}</span>
                <i v-if="isPinned(row.entry)" class="pi pi-bookmark-fill palette__pin" :aria-label="$t('palette.pinned')" />
                <kbd v-if="row.entry.shortcut" class="palette__shortcut">{{ row.entry.shortcut }}</kbd>
                <span v-if="kindOf(row.entry) === 'actions'" class="palette__run">{{ $t('palette.run') }}</span>
                <i v-else class="pi pi-arrow-right palette__go" aria-hidden="true" />
              </a>
            </template>
          </div>

          <div v-else-if="loading" class="palette__state"><ProgressSpinner class="palette__spinner" stroke-width="6" /></div>

          <div v-else class="palette__state">
            <i class="pi pi-inbox" aria-hidden="true" />
            <span>{{ query ? $t('labels.no_results') : $t('labels.search_hint') }}</span>
          </div>
        </div>

        <aside class="palette__preview" :aria-label="$t('palette.preview')">
          <template v-if="preview">
            <div class="palette__hero">
              <span class="palette__tile palette__tile--big" :class="`palette__tile--${kindOf(preview.entry)}`">
                <i class="pi" :class="iconOf(preview.entry)" aria-hidden="true" />
              </span>
              <div class="palette__hero-text">
                <span class="palette__kind">{{ groupLabel(kindOf(preview.entry)) }}</span>
                <h3 class="palette__name">{{ preview.entry.title }}</h3>
              </div>
            </div>

            <div v-if="preview.badge" class="palette__status palette__status--info">{{ preview.badge }}</div>
            <div v-if="preview.status" class="palette__status" :class="`palette__status--${preview.status}`">
              <span class="palette__dot" :class="`palette__dot--${TONES[preview.status]}`" aria-hidden="true" />
              {{ preview.statusText }}
            </div>
            <ul v-if="preview.reasons?.length" class="palette__reasons">
              <li v-for="reason in preview.reasons" :key="reason">{{ reason }}</li>
            </ul>

            <div v-if="preview.summary?.total" class="palette__bar" role="img" :aria-label="`${preview.summary.ok}/${preview.summary.total}`">
              <span v-if="preview.summary.ok" class="palette__seg palette__seg--ok" :style="{ flexGrow: preview.summary.ok }" />
              <span v-if="preview.summary.bad" class="palette__seg palette__seg--bad" :style="{ flexGrow: preview.summary.bad }" />
              <span v-if="preview.summary.checking" class="palette__seg palette__seg--wait" :style="{ flexGrow: preview.summary.checking }" />
            </div>

            <p v-if="preview.description" class="palette__description">{{ preview.description }}</p>

            <dl v-if="preview.facts.length" class="palette__facts">
              <template v-for="fact in preview.facts" :key="fact.label">
                <dt>{{ fact.label }}</dt>
                <dd :class="[fact.tone ? `palette__fact--${fact.tone}` : null, { palette__mono: fact.mono }]">{{ fact.value }}</dd>
              </template>
            </dl>

            <div class="palette__actions">
              <PrimeButton
                size="small"
                :label="kindOf(preview.entry) === 'actions' ? $t('palette.run') : $t('palette.open')"
                :icon="kindOf(preview.entry) === 'actions' ? 'pi pi-play' : 'pi pi-arrow-right'"
                :icon-pos="kindOf(preview.entry) === 'actions' ? 'left' : 'right'"
                @click="go(preview.entry)"
              />
              <PrimeButton
                v-for="action in preview.actions"
                :key="action.id"
                size="small"
                severity="secondary"
                outlined
                :name="action.id"
                :label="action.label"
                :icon="`pi ${action.icon}`"
                @click="go(action)"
              />
              <PrimeButton
                v-if="!preview.entry.transient"
                size="small"
                severity="secondary"
                text
                name="palette-pin"
                :label="isPinned(preview.entry) ? $t('palette.unpin') : $t('palette.pin')"
                :icon="isPinned(preview.entry) ? 'pi pi-bookmark-fill' : 'pi pi-bookmark'"
                @click="pinEntry(preview.entry)"
              />
            </div>
          </template>
          <div v-else class="palette__idle">
            <i class="pi pi-compass" aria-hidden="true" />
            <span>{{ $t('palette.idle') }}</span>
          </div>
        </aside>
      </div>

      <footer class="palette__footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> {{ $t('palette.navigate') }}</span>
        <span><kbd>↵</kbd> {{ current && kindOf(current) === 'actions' ? $t('palette.run') : $t('palette.open') }}</span>
        <span v-if="preview?.actions?.length"><kbd>⌘</kbd><kbd>↵</kbd> {{ preview.actions[0].label }}</span>
        <span><kbd>Tab</kbd> {{ $t('palette.filter') }}</span>
        <span><kbd>&gt;</kbd> {{ $t('labels.search_actions') }}</span>
      </footer>
    </div>
  </PrimeDialog>

  <GeneratePreviewDialog
    v-if="generateTargets.length"
    v-model:visible="generateOpen"
    :products="generateTargets"
    @confirm="startGeneration"
  />
</template>

<style scoped lang="scss">
.palette {
  --tone-ok: var(--status-ok, #1c9d6c);
  --tone-bad: var(--status-bad, #d33f4f);
  --tone-warn: var(--status-warn, #c77b13);
  --tone-wait: var(--p-text-muted-color);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  background: var(--p-content-background);
  color: var(--text-heading);

  &__header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
  }

  &__lens { font-size: 1.1rem; color: var(--text-muted); }

  &__input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    font: inherit;
    font-size: 1rem;
    color: inherit;

    &::placeholder { color: var(--text-muted); opacity: 0.8; }
  }

  &__spinner { width: 16px; height: 16px; }

  &__clear {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text-muted);
    cursor: pointer;

    &:hover { background: var(--p-content-hover-background); color: var(--text-heading); }
  }

  &__kbd,
  &__footer kbd {
    display: inline-block;
    min-width: 20px;
    padding: 1px 6px;
    border: 1px solid var(--card-border);
    border-bottom-width: 2px;
    border-radius: 5px;
    background: var(--p-content-hover-background);
    font: inherit;
    font-size: 0.6875rem;
    line-height: 1.4;
    text-align: center;
    color: var(--text-muted);
  }

  &__chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    padding: 0 18px 12px;
  }

  &__chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border: 1px solid var(--card-border);
    border-radius: 99px;
    background: none;
    font: inherit;
    font-size: 0.75rem;
    color: var(--text-muted);
    cursor: pointer;

    .pi { font-size: 0.7rem; }
    &:hover { color: var(--text-heading); border-color: var(--text-muted); }

    &--on {
      border-color: var(--p-primary-color);
      background: var(--p-highlight-background, color-mix(in srgb, var(--p-primary-color) 12%, transparent));
      color: var(--p-primary-color);
      font-weight: 600;
    }
  }

  &__count { font-variant-numeric: tabular-nums; opacity: 0.75; }

  &__body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    height: 420px;
    border-top: 1px solid var(--card-border);
  }

  &__list { overflow-y: auto; padding: 4px 0 8px; min-width: 0; }

  &__group {
    padding: 10px 18px 4px;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-muted);
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0 8px;
    padding: 7px 10px;
    border-radius: 8px;
    color: inherit;
    text-decoration: none;
    cursor: pointer;

    &--active {
      background: var(--p-highlight-background, color-mix(in srgb, var(--p-primary-color) 10%, transparent));
      .palette__go { opacity: 1; transform: translateX(0); }
    }
  }

  &__tile {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    font-size: 0.95rem;
    background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
    color: var(--p-primary-color);

    &--products { background: color-mix(in srgb, var(--tone-ok) 14%, transparent); color: var(--tone-ok); }
    &--modules,
    &--metamodels { background: color-mix(in srgb, var(--tone-warn) 14%, transparent); color: var(--tone-warn); }
    &--actions { background: var(--p-primary-color); color: var(--p-primary-contrast-color); }
    &--pages { background: var(--p-content-hover-background); color: var(--text-muted); }

    &--big { width: 44px; height: 44px; border-radius: 11px; font-size: 1.2rem; }
  }

  &__text { flex: 1; min-width: 0; display: flex; flex-direction: column; }

  &__title,
  &__caption { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  &__title { font-size: 0.875rem; color: var(--text-heading); }
  &__caption { font-size: 0.75rem; color: var(--text-muted); }

  mark {
    background: none;
    color: var(--p-primary-color);
    font-weight: 700;
  }

  &__dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--tone-wait);

    &--ok { background: var(--tone-ok); }
    &--bad { background: var(--tone-bad); }
    &--warn { background: var(--tone-warn); }
  }

  &__badge {
    flex: none;
    padding: 1px 8px;
    border-radius: 99px;
    font-size: 0.6875rem;
    font-weight: 600;
    background: var(--p-content-hover-background);
    color: var(--text-muted);
  }

  &__pin { flex: none; font-size: 0.7rem; color: var(--p-primary-color); }

  &__shortcut {
    flex: none;
    padding: 0 6px;
    border: 1px solid var(--card-border);
    border-radius: 5px;
    font: inherit;
    font-size: 0.6875rem;
    color: var(--text-muted);
  }

  &__run {
    flex: none;
    padding: 1px 9px;
    border-radius: 6px;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
    color: var(--p-primary-color);
    opacity: 0.55;
  }

  &__item--active .palette__run { opacity: 1; background: var(--p-primary-color); color: var(--p-primary-contrast-color); }

  &__go {
    flex: none;
    font-size: 0.75rem;
    color: var(--text-muted);
    opacity: 0;
    transform: translateX(-4px);
    transition: opacity 0.12s, transform 0.12s;
  }

  &__state,
  &__idle {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 100%;
    padding: 24px;
    font-size: 0.875rem;
    text-align: center;
    color: var(--text-muted);

    .pi { font-size: 1.6rem; }
  }

  &__preview {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    padding: 18px;
    overflow-y: auto;
    border-left: 1px solid var(--card-border);
    background: var(--p-content-hover-background);
  }

  &__hero { display: flex; align-items: center; gap: 12px; min-width: 0; }
  &__hero-text { min-width: 0; display: flex; flex-direction: column; }
  &__kind { font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-muted); }
  &__name { margin: 0; font-size: 1.05rem; font-weight: 600; overflow-wrap: anywhere; }

  &__status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    align-self: flex-start;
    padding: 3px 12px 3px 10px;
    border-radius: 99px;
    font-size: 0.75rem;
    font-weight: 600;
    background: color-mix(in srgb, var(--tone-wait) 14%, transparent);
    color: var(--tone-wait);

    &--ok { background: color-mix(in srgb, var(--tone-ok) 14%, transparent); color: var(--tone-ok); }
    &--bad { background: color-mix(in srgb, var(--tone-bad) 14%, transparent); color: var(--tone-bad); }
    &--info { background: color-mix(in srgb, var(--p-primary-color) 14%, transparent); color: var(--p-primary-color); }
  }

  &__reasons {
    margin: -4px 0 0;
    padding-left: 18px;
    font-size: 0.75rem;
    color: var(--tone-bad);
  }

  &__bar {
    display: flex;
    gap: 2px;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
  }

  &__seg {
    min-width: 4px;
    &--ok { background: var(--tone-ok); }
    &--bad { background: var(--tone-bad); }
    &--wait { background: var(--tone-wait); opacity: 0.5; }
  }

  &__description { margin: 0; font-size: 0.8125rem; line-height: 1.5; color: var(--text-muted); }

  &__facts {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 6px 14px;
    margin: 0;
    font-size: 0.8125rem;

    dt { color: var(--text-muted); }
    dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
  }

  &__fact--ok { color: var(--tone-ok); }
  &__fact--warn { color: var(--tone-warn); }
  &__fact--bad { color: var(--tone-bad); }
  &__mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.75rem; }

  &__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; padding-top: 4px; }

  &__footer {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    padding: 9px 18px;
    border-top: 1px solid var(--card-border);
    font-size: 0.75rem;
    color: var(--text-muted);

    kbd { margin-right: 3px; }
  }
}

@media (max-width: 760px) {
  .palette__body { grid-template-columns: minmax(0, 1fr); height: 60vh; }
  .palette__preview { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .palette__go { transition: none; }
}
</style>
