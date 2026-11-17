<script setup>
import { computed, getCurrentInstance, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Menu from 'primevue/menu'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'
import { usePortfolio, ensureStatuses, cancelStatuses, ensureDeployments, loadCi } from 'src/composables/usePortfolio'
import { usePortfolioInbox } from 'src/composables/useAttentionInbox'
import { modelTabs } from 'components/modules/modulesTab'
import { reasonText } from 'src/utils/inboxReason'
import { middleTruncate } from 'src/utils/middleTruncate'
import { readRecent, rememberRecent } from 'src/utils/commandPalette'
import { relativeShort } from 'src/utils/relativeTime'
import { openSearch } from 'stores/searchDialog'
import productService from 'src/services/productService'
import productModelService from 'src/services/productModelService'
import issueService from 'src/services/issueService'
import { notify } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'

const route = useRoute()
const router = useRouter()
const instance = getCurrentInstance()
const t = useT()
const { lines, products } = usePortfolio({ statuses: false })
const { all: inboxAll } = usePortfolioInbox(products)

const TONE_WEIGHT = { bad: 3, warn: 2, info: 1 }
const needById = computed(() => new Map(inboxAll.value.map((item) => [item.id, item])))
const toneOf = (productId) => needById.value.get(String(productId))?.reasons[0]?.tone ?? null
const worstTone = (tones) => tones.filter(Boolean).sort((a, b) => TONE_WEIGHT[b] - TONE_WEIGHT[a])[0] ?? null
const reasonOf = (productId) => needById.value.get(String(productId))?.reasons[0] ?? null

const scope = ref('all')
const filter = ref('')
const filterInput = ref(null)
const expanded = ref({})

const productNode = (p) => ({
  key: `product:${p._id}`,
  id: String(p._id),
  label: p.name,
  type: 'product',
  path: `/products/${p._id}`,
  tone: toneOf(p._id),
  reason: reasonOf(p._id),
})

const tree = computed(() => {
  if (!lines.value) return []
  const allProducts = products.value || []
  const orphans = new Map()
  for (const p of allProducts.filter((product) => product.lineDeleted)) {
    const key = String(p.lineId)
    if (!orphans.has(key)) orphans.set(key, { name: p.line, products: [] })
    orphans.get(key).products.push(p)
  }
  const deletedLines = [...orphans].map(([id, { name, products: own }]) => ({
    key: `line:${id}`,
    id,
    label: name ?? '—',
    type: 'line',
    deleted: true,
    path: null,
    tone: null,
    need: 0,
    total: own.length,
    children: own.map(productNode),
  }))
  return [...lines.value.map((line) => {
    const own = allProducts.filter((p) => !p.lineDeleted && p.line === line.name)
    const children = own.map(productNode)
    const needing = children.filter((child) => child.tone)
    return {
      key: `line:${line._id}`,
      id: String(line._id),
      label: line.name,
      type: 'line',
      path: `/lines/${line._id}`,
      tone: worstTone(needing.map((child) => child.tone)),
      need: needing.length,
      total: own.length,
      children,
    }
  }), ...deletedLines]
})

const needTotal = computed(() => inboxAll.value.length)

const currentProduct = computed(() => {
  const match = route.path.match(/^\/products\/([^/]+)/)
  return match ? (products.value || []).find((p) => String(p._id) === match[1]) ?? null : null
})
const currentLineId = computed(() => {
  const lineMatch = route.path.match(/^\/lines\/([^/]+)/)
  if (lineMatch) return lineMatch[1]
  const product = currentProduct.value
  if (!product) return null
  const parent = (lines.value || []).find((l) => l.name === product.line)
  return parent ? String(parent._id) : null
})

const counts = ref({ mrs: null, issues: null })
let countsToken = 0
async function loadCounts(id) {
  const token = ++countsToken
  counts.value = { mrs: null, issues: null }
  const [mrs, issues] = await Promise.allSettled([
    productService.listMergeRequests({ id }),
    issueService.list({ kind: 'product', id, filter: { state: 'opened' } }),
  ])
  if (token !== countsToken) return
  counts.value = {
    mrs: mrs.status === 'fulfilled' && Array.isArray(mrs.value) ? mrs.value.filter((mr) => mr.state === 'opened').length : null,
    issues: issues.status === 'fulfilled' && Array.isArray(issues.value?.items) ? issues.value.items.length : null,
  }
}

const productId = computed(() => (route.path.match(/^\/products\/([^/]+)/) || [])[1] ?? null)
watch(productId, (id) => {
  if (!id) return
  rememberRecent(`product:${id}`)
  loadCounts(id)
}, { immediate: true })

const siblings = computed(() => {
  const product = currentProduct.value
  if (!product) return []
  return (products.value || []).filter((p) => p.line === product.line && !p.lineDeleted)
})

const context = computed(() => {
  const lineMatch = route.path.match(/^\/lines\/([^/]+)/)
  const activeTab = (fallback) => {
    const value = String(route.query.tab || fallback)
    return value === 'activity' || value === 'deployments' ? 'cicd' : value
  }
  const product = currentProduct.value
  if (productId.value) {
    const parent = product ? (lines.value || []).find((l) => l.name === product.line) : null
    const base = `/products/${productId.value}`
    const own = needById.value.get(productId.value)
    const cicdFails = Boolean(own?.reasons.some((reason) => reason.key === 'pipeline' || reason.key === 'generation'))
    const badgeOf = (key) => (key === 'mrs' ? counts.value.mrs : key === 'issues' ? counts.value.issues : key === 'siblings' ? Math.max(siblings.value.length - 1, 0) : undefined)
    return {
      kind: 'product',
      title: product ? product.name : '',
      parent: parent ? { label: parent.name, path: `/lines/${parent._id}` } : null,
      alert: own ? { text: reasonText(own.reasons[0], t), tone: own.reasons[0].tone, since: own.since, path: own.action.tab ? `${base}?tab=${own.action.tab}` : base } : null,
      items: [
        { key: 'overview', icon: 'pi-home', labelKey: 'labels.overview' },
        { key: 'models', icon: 'pi-th-large', labelKey: 'labels.tab_config' },
        { key: 'mrs', icon: 'pi-share-alt', labelKey: 'mrs.tab' },
        { key: 'issues', icon: 'pi-exclamation-circle', labelKey: 'issues.tab' },
        { key: 'history', icon: 'pi-history', labelKey: 'labels.tab_versions' },
        { key: 'cicd', icon: 'pi-sync', labelKey: 'labels.tab_cicd' },
        { key: 'siblings', icon: 'pi-sitemap', labelKey: 'labels.tab_siblings' },
        { key: 'settings', icon: 'pi-cog', labelKey: 'labels.tab_settings' },
      ].map((i) => ({
        ...i,
        path: `${base}?tab=${i.key}`,
        active: activeTab('overview') === i.key,
        badge: badgeOf(i.key),
        dot: i.key === 'cicd' && cicdFails,
      })),
    }
  }
  if (lineMatch) {
    const line = (lines.value || []).find((l) => String(l._id) === lineMatch[1])
    const id = lineMatch[1]
    const base = `/lines/${id}`
    const onModel = route.path.endsWith('/model')
    const onModules = route.path.endsWith('/modules')
    const onMetamodels = route.path.endsWith('/metamodels')
    const items = [
      { key: 'products', icon: 'pi-box', labelKey: 'modules.tab_products', path: `${base}?tab=products`, badge: tree.value.find((l) => l.key === `line:${id}`)?.total },
      ...modelTabs(id, line, onModules ? 'modules' : null),
      { key: 'mrs', icon: 'pi-share-alt', labelKey: 'mrs.tab', path: `${base}?tab=mrs` },
      { key: 'issues', icon: 'pi-exclamation-circle', labelKey: 'issues.tab', path: `${base}?tab=issues` },
      { key: 'history', icon: 'pi-history', labelKey: 'labels.history_tab', path: `${base}?tab=history` },
      { key: 'cicd', icon: 'pi-cloud', labelKey: 'labels.tab_cicd', path: `${base}?tab=cicd` },
    ].map((i) => ({
      ...i,
      active: i.key === 'modules' ? onModules : i.key === 'metamodels' ? onMetamodels : i.key === 'model' ? onModel : !onModel && !onModules && !onMetamodels && activeTab('products') === i.key,
    }))
    return {
      kind: 'line',
      title: line ? line.name : '',
      parent: null,
      alert: null,
      items,
    }
  }
  return null
})

const switcher = ref(null)
const switcherItems = computed(() => siblings.value
  .filter((p) => String(p._id) !== productId.value)
  .map((p) => ({ label: p.name, command: () => router.push(`/products/${p._id}`) })))
const toggleSwitcher = (event) => switcher.value?.toggle(event)

const COLLAPSED_STORAGE_KEY = 'linea-explorer-collapsed'
const RENAMED_COLLAPSED_STORAGE_KEY = 'linea-explorador-plegado'
const NARROW_WIDTH_QUERY = '(max-width: 1100px)'

function readCollapsedPreference() {
  const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY)
  if (stored !== null) return stored === '1'
  const renamed = localStorage.getItem(RENAMED_COLLAPSED_STORAGE_KEY)
  if (renamed === null) return false
  localStorage.setItem(COLLAPSED_STORAGE_KEY, renamed)
  localStorage.removeItem(RENAMED_COLLAPSED_STORAGE_KEY)
  return renamed === '1'
}

const collapsedPreference = ref(readCollapsedPreference())
const mediaQuery = window.matchMedia(NARROW_WIDTH_QUERY)
const narrow = ref(mediaQuery.matches)
const collapsed = ref(narrow.value || collapsedPreference.value)

const onWidthChange = (event) => {
  narrow.value = event.matches
  collapsed.value = event.matches ? true : collapsedPreference.value
}

const isTyping = (event) => {
  const target = event.target
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

const onKeyDown = (event) => {
  if (event.key === 'Escape' && overlay.value) {
    collapsed.value = true
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event)) return
  if (event.key === '/') {
    event.preventDefault()
    if (collapsed.value) toggleCollapsed()
    setTimeout(() => filterInput.value?.$el?.focus(), 0)
  } else if (event.key === '[') {
    toggleCollapsed()
  }
}

mediaQuery.addEventListener('change', onWidthChange)
window.addEventListener('keydown', onKeyDown)
onBeforeUnmount(() => {
  mediaQuery.removeEventListener('change', onWidthChange)
  window.removeEventListener('keydown', onKeyDown)
})

const overlay = computed(() => narrow.value && !collapsed.value)

// the dots and the badges are the health of every product: asked for a moment after the page itself has what it came for
let statusesTimer = null
async function askStatuses() {
  await ensureStatuses()
  await ensureDeployments()
  await loadCi((products.value || []).map((p) => String(p._id)))
}
onBeforeUnmount(() => { clearTimeout(statusesTimer); cancelStatuses() })
statusesTimer = setTimeout(askStatuses, 2500)

function toggleCollapsed() {
  collapsed.value = !collapsed.value
  if (narrow.value) return
  collapsedPreference.value = collapsed.value
  localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed.value ? '1' : '0')
}

watch(
  () => route.path,
  () => {
    if (narrow.value) collapsed.value = true
  },
)

const showNeeding = () => {
  scope.value = 'need'
  if (collapsed.value) toggleCollapsed()
}

const filteredNodes = computed(() => {
  const text = filter.value.trim().toLowerCase()
  const needOnly = scope.value === 'need'
  const matchesText = (s) => s.toLowerCase().includes(text)
  return tree.value
    .map((line) => {
      let children = needOnly ? line.children.filter((p) => p.tone) : line.children
      if (needOnly && !children.length) return null
      if (!text) return { ...line, children }
      if (matchesText(line.label)) return { ...line, children }
      children = children.filter((p) => matchesText(p.label))
      return children.length ? { ...line, children } : null
    })
    .filter(Boolean)
})

const isOpen = (node) => Boolean(expanded.value[node.key]) || Boolean(filter.value.trim()) || scope.value === 'need'

watch(
  [() => route.path, tree],
  () => {
    if (!productId.value) return
    const key = `product:${productId.value}`
    const parent = tree.value.find((l) => l.children.some((p) => p.key === key))
    if (parent && expanded.value[parent.key] === undefined) expanded.value = { ...expanded.value, [parent.key]: true }
  },
  { immediate: true },
)

const recents = computed(() => {
  const byId = new Map((products.value || []).map((p) => [String(p._id), p]))
  return readRecent()
    .filter((id) => id.startsWith('product:'))
    .map((id) => byId.get(id.slice('product:'.length)))
    .filter((p) => p && !p.lineDeleted && String(p._id) !== productId.value)
    .slice(0, 3)
    .map(productNode)
})

const inLine = computed(() => {
  const text = filter.value.trim().toLowerCase()
  return siblings.value.map(productNode).filter((p) => !text || p.label.toLowerCase().includes(text))
})

const railLines = computed(() => tree.value.filter((line) => !line.deleted).map((line) => ({
  ...line,
  initials: line.label.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '··',
  current: line.id === currentLineId.value,
})))

const railTitle = (line) => t('labels.explorer_rail_line', { name: line.label, total: line.total, need: line.need })

function go(path) {
  if (path && path !== route.fullPath) router.push(path)
}

function toggleBranch(node) {
  expanded.value = { ...expanded.value, [node.key]: !isOpen(node) }
}

const newProductMenu = ref(null)
const newProductItems = computed(() => (lines.value || []).map((line) => ({ label: line.name, command: () => router.push(`/lines/${line._id}/new-product`) })))
function newProduct(event) {
  const target = currentLineId.value ?? ((lines.value || []).length === 1 ? String(lines.value[0]._id) : null)
  if (target) router.push(`/lines/${target}/new-product`)
  else if ((lines.value || []).length) newProductMenu.value?.toggle(event)
  else router.push('/add')
}

const syncing = ref(false)
async function syncProduct() {
  if (!productId.value || syncing.value) return
  syncing.value = true
  try {
    await productModelService.syncProductModels({ id: productId.value })
    notify({ position: 'bottom-right', type: 'positive', message: t('modules.models_synced') })
  } catch (e) {
    notify({ position: 'bottom-right', type: 'negative', message: t(e.response?.data?.error || 'error_messages.internal_error') })
  } finally {
    syncing.value = false
  }
}

const since = (at) => (at ? relativeShort(at, instance?.proxy?.$i18n?.locale) : '')
const shown = (node, max = 24) => middleTruncate(node.label, node.reason ? 20 : max)
</script>

<template>
  <div
    v-if="overlay"
    class="explorer-overlay"
    :aria-label="$t('labels.explorer_collapse')"
    @click="toggleCollapsed"
  />

  <aside
    class="explorer"
    :class="{ 'explorer--collapsed': collapsed, 'explorer--overlay': overlay }"
  >
    <nav v-if="collapsed" class="explorer__rail" :aria-label="$t('labels.explorer')">
      <button type="button" class="explorer__rail-item" name="rail-search" :title="`${$t('labels.search')} (Ctrl+K)`" :aria-label="$t('labels.search')" @click="openSearch()">
        <i class="pi pi-search" aria-hidden="true" />
      </button>
      <button type="button" class="explorer__rail-item" name="rail-need" :title="$t('labels.explorer_scope_need')" :aria-label="$t('labels.explorer_scope_need')" @click="showNeeding">
        <i class="pi pi-bell" aria-hidden="true" />
        <span v-if="needTotal" class="explorer__rail-badge">{{ needTotal }}</span>
      </button>
      <span class="explorer__rail-sep" />
      <button
        v-for="line in railLines"
        :key="line.key"
        type="button"
        class="explorer__rail-line"
        :class="{ 'explorer__rail-line--current': line.current }"
        :title="railTitle(line)"
        :aria-label="railTitle(line)"
        @click="go(line.path)"
      >
        {{ line.initials }}
        <span v-if="line.tone" class="explorer__rail-dot" :class="`explorer__dot--${line.tone}`" />
      </button>
      <span class="explorer__rail-grow" />
      <button type="button" class="explorer__rail-item" name="rail-new-product" :title="$t('labels.explorer_new_product')" :aria-label="$t('labels.explorer_new_product')" @click="newProduct">
        <i class="pi pi-plus" aria-hidden="true" />
      </button>
      <button type="button" class="explorer__rail-item explorer__toggle--rail" :title="$t('labels.explorer_expand')" :aria-label="$t('labels.explorer_expand')" :aria-expanded="false" @click="toggleCollapsed">
        <i class="pi pi-angle-double-right" aria-hidden="true" />
      </button>
    </nav>

    <template v-else>
      <section v-if="context" class="explorer__context">
        <button v-if="context.parent" type="button" class="explorer__parent" @click="router.push(context.parent.path)">
          <i class="pi pi-angle-left" aria-hidden="true" />
          <span>{{ context.parent.label }}</span>
        </button>
        <button v-if="context.kind === 'product'" type="button" class="explorer__entity explorer__entity--switch" :title="context.title" aria-haspopup="true" @click="toggleSwitcher">
          <span class="explorer__entity-name">{{ context.title }}</span>
          <i class="pi pi-chevron-down" aria-hidden="true" />
        </button>
        <div v-else class="explorer__entity" :title="context.title">
          <span class="explorer__entity-name">{{ context.title }}</span>
        </div>
        <Menu v-if="context.kind === 'product'" ref="switcher" :model="switcherItems" popup />

        <button v-if="context.alert" type="button" class="explorer__alert" :class="`explorer__alert--${context.alert.tone}`" name="explorer-alert" @click="router.push(context.alert.path)">
          <span class="explorer__alert-text">{{ context.alert.text }}<template v-if="context.alert.since"> · {{ since(context.alert.since) }}</template></span>
          <span class="explorer__alert-action">{{ $t('labels.explorer_view') }}</span>
        </button>

        <nav class="explorer__menu">
          <button
            v-for="item in context.items"
            :key="item.key"
            type="button"
            class="explorer__menu-item"
            :class="{ 'explorer__menu-item--active': item.active }"
            :aria-current="item.active ? 'page' : undefined"
            @click="router.push(item.path)"
          >
            <i class="pi" :class="item.icon" aria-hidden="true" />
            <span class="explorer__menu-label">{{ $t(item.labelKey) }}</span>
            <span v-if="item.dot" class="explorer__dot explorer__dot--bad" />
            <span v-if="item.badge !== undefined && item.badge !== null" class="explorer__menu-badge">{{ item.badge }}</span>
          </button>
        </nav>
      </section>

      <div class="explorer__filter">
        <IconField>
          <InputIcon>
            <i class="pi pi-search explorer__search-icon" aria-hidden="true" />
          </InputIcon>
          <InputText
            ref="filterInput"
            v-model="filter"
            size="small"
            :placeholder="$t('labels.explorer_filter')"
            :aria-label="$t('labels.explorer_filter')"
            class="explorer__input"
          />
          <InputIcon v-if="filter" class="explorer__clear" @click="filter = ''">
            <i class="pi pi-times" style="font-size: 12px" aria-hidden="true" />
          </InputIcon>
          <InputIcon v-else class="explorer__hint"><kbd>/</kbd></InputIcon>
        </IconField>
      </div>

      <div v-if="context?.kind !== 'product'" class="explorer__scope" role="group" :aria-label="$t('labels.explorer')">
        <button type="button" class="explorer__scope-option" :class="{ 'explorer__scope-option--on': scope === 'all' }" :aria-pressed="scope === 'all'" name="scope-all" @click="scope = 'all'">
          {{ $t('labels.explorer_scope_all') }} <span>{{ (products || []).filter((p) => !p.lineDeleted).length }}</span>
        </button>
        <button type="button" class="explorer__scope-option" :class="{ 'explorer__scope-option--on': scope === 'need' }" :aria-pressed="scope === 'need'" name="scope-need" @click="scope = 'need'">
          {{ $t('labels.explorer_scope_need') }} <span>{{ needTotal }}</span>
        </button>
      </div>

      <div class="explorer__body">
        <template v-if="context?.kind === 'product'">
          <div class="explorer__section">
            <span>{{ $t('labels.explorer_in_line') }}</span>
          </div>
          <ul class="explorer__list">
            <li v-for="node in inLine" :key="node.key" class="explorer__item" :class="{ 'explorer__item--current': node.id === productId }">
              <span class="explorer__dot" :class="node.tone ? `explorer__dot--${node.tone}` : ''" />
              <a class="explorer__link" :href="node.path" :title="node.label" @click.prevent="go(node.path)">
                <span class="explorer__name">{{ shown(node) }}</span>
              </a>
              <span v-if="node.reason" class="explorer__reason" :class="`explorer__reason--${node.tone}`">{{ reasonText(node.reason, $t) }}</span>
            </li>
          </ul>
          <a class="explorer__all" href="/" @click.prevent="go('/')">
            <span>{{ $t('labels.explorer_all_lines') }}</span>
            <span v-if="needTotal" class="explorer__badge explorer__badge--bad">{{ needTotal }}</span>
          </a>
        </template>

        <template v-else>
          <template v-if="!context && scope === 'all' && !filter.trim() && recents.length">
            <div class="explorer__section"><span>{{ $t('labels.explorer_recent') }}</span></div>
            <ul class="explorer__list">
              <li v-for="node in recents" :key="node.key" class="explorer__item">
                <span class="explorer__dot" :class="node.tone ? `explorer__dot--${node.tone}` : ''" />
                <a class="explorer__link" :href="node.path" :title="node.label" @click.prevent="go(node.path)">
                  <span class="explorer__name">{{ shown(node) }}</span>
                </a>
                <span v-if="node.reason" class="explorer__reason" :class="`explorer__reason--${node.tone}`">{{ reasonText(node.reason, $t) }}</span>
              </li>
            </ul>
          </template>

          <div class="explorer__section">
            <span>{{ $t('labels.explorer_lines') }}</span>
            <button type="button" class="explorer__plus" name="new-line" :title="$t('labels.explorer_new_line')" :aria-label="$t('labels.explorer_new_line')" @click="router.push('/add')">
              <i class="pi pi-plus" aria-hidden="true" />
            </button>
          </div>

          <ul class="explorer__list" role="tree">
            <template v-for="line in filteredNodes" :key="line.key">
              <li class="explorer__item explorer__item--line" role="treeitem" :aria-expanded="line.children.length ? isOpen(line) : undefined">
                <button
                  type="button"
                  class="explorer__chevron"
                  :class="{ 'explorer__chevron--open': isOpen(line) }"
                  :aria-label="$t('labels.explorer_toggle_line')"
                  :disabled="!line.children.length"
                  @click="toggleBranch(line)"
                >
                  <i class="pi pi-chevron-right" aria-hidden="true" />
                </button>
                <component
                  :is="line.path ? 'a' : 'span'"
                  class="explorer__link"
                  :href="line.path || undefined"
                  :title="line.label"
                  @click.prevent="go(line.path)"
                >
                  <span class="explorer__name explorer__name--line" :class="{ 'explorer__name--deleted': line.deleted }">{{ line.label }}</span>
                </component>
                <span v-if="line.deleted" class="explorer__deleted">{{ $t('labels.line_deleted') }}</span>
                <span v-if="line.need" class="explorer__badge" :class="`explorer__badge--${line.tone}`" :title="$t('labels.explorer_scope_need')">{{ line.need }}</span>
                <span class="explorer__count">{{ line.total }}</span>
              </li>
              <template v-if="isOpen(line)">
                <li v-for="node in line.children" :key="node.key" class="explorer__item explorer__item--product" :class="{ 'explorer__item--current': node.id === productId }" role="treeitem">
                  <span class="explorer__dot" :class="node.tone ? `explorer__dot--${node.tone}` : ''" />
                  <a class="explorer__link" :href="node.path" :title="node.label" @click.prevent="go(node.path)">
                    <span class="explorer__name">{{ shown(node) }}</span>
                  </a>
                  <span v-if="node.reason" class="explorer__reason" :class="`explorer__reason--${node.tone}`">{{ reasonText(node.reason, $t) }}</span>
                </li>
              </template>
            </template>
          </ul>

          <p v-if="!filteredNodes.length" class="explorer__empty">
            {{ $t('labels.explorer_empty') }}
          </p>
        </template>
      </div>

      <div class="explorer__footer">
        <button v-if="context?.kind === 'product'" type="button" class="explorer__action" name="explorer-sync" :disabled="syncing" @click="syncProduct">
          <i class="pi pi-sync" :class="{ 'pi-spin': syncing }" aria-hidden="true" />
          {{ $t('labels.explorer_sync') }}
        </button>
        <button v-else type="button" class="explorer__action" name="explorer-new-product" @click="newProduct">
          <i class="pi pi-plus" aria-hidden="true" />
          {{ $t('labels.explorer_new_product') }}
        </button>
        <Menu ref="newProductMenu" :model="newProductItems" popup />
        <button
          type="button"
          class="explorer__toggle"
          :aria-label="`${$t('labels.explorer_collapse')} ([)`"
          :title="`${$t('labels.explorer_collapse')} ([)`"
          :aria-expanded="true"
          @click="toggleCollapsed"
        >
          <i class="pi pi-angle-double-left" aria-hidden="true" />
        </button>
      </div>
    </template>
  </aside>
</template>

<style scoped lang="scss">
.explorer {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding-top: 12px;
  background: var(--p-content-background);
  border-right: 1px solid var(--p-content-border-color);
  transition: width 0.18s ease;

  &--collapsed {
    width: 56px;
    align-items: center;
    padding-top: 12px;
  }

  &--overlay {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 21;
    box-shadow: 0 0 24px var(--overlay-shadow);
  }

  &__toggle {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--p-text-muted-color);
    cursor: pointer;

    &:hover {
      background: var(--p-content-hover-background);
      color: var(--p-text-color);
    }

    &:focus-visible {
      outline: 2px solid var(--p-primary-color);
      outline-offset: 1px;
    }

    i { font-size: 13px; }
  }

  &__rail {
    width: 100%;
    flex: 1;
    min-height: 0;
    padding: 0 10px 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    overflow-y: auto;
  }

  &__rail-grow { flex: 1; }

  &__rail-item {
    position: relative;
    width: 36px;
    height: 32px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--p-text-muted-color);
    cursor: pointer;

    i { font-size: 15px; }

    &:hover {
      background: var(--p-content-hover-background);
      color: var(--p-text-color);
    }

    &:focus-visible {
      outline: 2px solid var(--p-primary-color);
      outline-offset: 1px;
    }
  }

  &__rail-badge {
    position: absolute;
    top: 0;
    right: 0;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 600;
    line-height: 16px;
    text-align: center;
    color: var(--status-on-solid);
    background: var(--status-bad-solid);
  }

  &__rail-line {
    position: relative;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    padding: 0;
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;
    background: var(--p-surface-ground);
    color: var(--p-text-muted-color);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;

    &:hover { color: var(--p-text-color); background: var(--p-content-hover-background); }

    &--current {
      color: var(--p-primary-color);
      border-color: var(--p-primary-color);
      background: var(--p-highlight-soft);
    }

    &:focus-visible {
      outline: 2px solid var(--p-primary-color);
      outline-offset: 1px;
    }
  }

  &__rail-dot {
    position: absolute;
    top: -3px;
    right: -3px;
    width: 8px;
    height: 8px;
    border: 2px solid var(--p-content-background);
    box-sizing: content-box;
  }

  &__rail-sep {
    width: 20px;
    height: 1px;
    margin: 2px 0;
    background: var(--p-content-border-color);
  }

  &__context {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0 12px 12px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--p-content-hover-background);
  }

  &__parent {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    font-size: 11px;
    color: var(--p-text-dim-color);
    min-width: 0;

    span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    &:hover { color: var(--p-text-color); }
  }

  &__entity {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;

    &--switch {
      padding: 4px 6px;
      margin: 0 -6px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;

      i { font-size: 10px; color: var(--p-text-muted-color); }
      &:hover { background: var(--p-content-hover-background); }
      &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 1px; }
    }
  }

  &__entity-name {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__alert {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 30px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;

    &--bad { color: var(--status-bad-strong); background: var(--status-bad-soft); }
    &--warn { color: var(--status-warn); background: var(--status-warn-soft); }
    &--info { color: var(--p-primary-color); background: var(--p-highlight-soft); }

    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 1px; }
  }

  &__alert-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__alert-action { flex-shrink: 0; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }

  &__menu {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  &__menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 30px;
    padding: 0 8px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--p-text-muted-color);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;

    i { font-size: 14px; width: 16px; }

    &:hover {
      background: var(--p-content-hover-background);
      color: var(--p-text-color);
    }

    &--active {
      background: var(--p-highlight-soft);
      color: var(--p-primary-color);
      font-weight: 500;
    }
  }

  &__menu-label { flex: 1; min-width: 0; }

  &__menu-badge {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--p-text-dim-color);
  }

  &__filter {
    padding: 0 12px 8px;
  }

  &__search-icon {
    font-size: 13px;
  }

  &__clear {
    cursor: pointer;
  }

  &__hint kbd {
    padding: 0 5px;
    border: 1px solid var(--p-content-border-color);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--p-text-dim-color);
  }

  &__input {
    width: 100%;
    height: 30px;
    border-radius: 5px;
    background: var(--p-surface-ground);
    font-size: 12px;
  }

  &__scope {
    display: flex;
    gap: 2px;
    margin: 0 12px 8px;
    padding: 2px;
    border-radius: 6px;
    background: var(--p-surface-ground);
  }

  &__scope-option {
    flex: 1;
    height: 24px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--p-text-muted-color);
    font: inherit;
    font-size: 12px;
    cursor: pointer;

    span { margin-left: 4px; font-family: var(--font-mono); font-size: 11px; color: var(--p-text-dim-color); }

    &--on {
      background: var(--p-content-background);
      color: var(--p-text-color);
      font-weight: 500;
    }

    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 1px; }
  }

  &__body {
    flex-grow: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 8px;
  }

  &__section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 6px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--p-text-dim-color);
  }

  &__plus {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--p-text-muted-color);
    cursor: pointer;

    i { font-size: 11px; }
    &:hover { background: var(--p-content-hover-background); color: var(--p-text-color); }
    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 1px; }
  }

  &__list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 26px;
    padding: 0 8px 0 6px;
    border-radius: 5px;

    &:hover { background: var(--p-content-hover-background); }

    &--product { padding-left: 26px; }

    &--current {
      background: var(--p-highlight-soft);
      .explorer__name { color: var(--p-primary-color); font-weight: 500; }
    }
  }

  &__chevron {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--p-text-muted-color);
    cursor: pointer;
    transition: transform 0.12s ease;

    i { font-size: 9px; }
    &--open { transform: rotate(90deg); }
    &:hover:not(:disabled) { color: var(--p-text-color); background: var(--p-content-hover-background); }
    &:disabled { visibility: hidden; cursor: default; }
    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 1px; }
  }

  &__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    background: transparent;

    &--info { background: var(--p-primary-color); }
    &--warn { background: var(--status-warn); }
    &--bad { background: var(--status-bad); }
  }

  &__link {
    flex: 1;
    display: flex;
    align-items: center;
    min-width: 0;
    color: inherit;
    text-decoration: none;
    cursor: pointer;

    &:hover .explorer__name {
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 1px; border-radius: 3px; }
  }

  &__name {
    min-width: 0;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &--line { font-weight: 500; }

    &--deleted {
      text-decoration: line-through;
      color: var(--p-text-muted-color);
    }
  }

  &__reason {
    flex-shrink: 0;
    max-width: 96px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;

    &--bad { color: var(--status-bad); }
    &--warn { color: var(--status-warn); }
    &--info { color: var(--p-primary-color); }
  }

  &__badge {
    flex-shrink: 0;
    min-width: 16px;
    height: 16px;
    padding: 0 5px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 600;
    line-height: 16px;
    text-align: center;
    color: var(--status-on-solid);
    background: var(--status-bad-solid);

    &--warn { background: var(--status-warn-solid); }
    &--info { background: var(--p-primary-color); }
  }

  &__count {
    flex-shrink: 0;
    min-width: 14px;
    text-align: right;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--p-text-dim-color);
  }

  &__deleted {
    flex-shrink: 0;
    padding: 0 6px;
    border-radius: 999px;
    font-size: 10px;
    color: var(--status-warn);
    background: var(--status-warn-soft);
  }

  &__all {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 28px;
    margin-top: 6px;
    padding: 0 8px;
    border-radius: 5px;
    font-size: 12px;
    color: var(--p-text-muted-color);
    text-decoration: none;
    cursor: pointer;

    &:hover { background: var(--p-content-hover-background); color: var(--p-text-color); }
  }

  &__empty {
    margin: 4px 8px;
    font-size: 12px;
    color: var(--p-text-dim-color);
  }

  &__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--p-content-hover-background);
  }

  &__action {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--p-text-muted-color);
    font: inherit;
    font-size: 12px;
    cursor: pointer;

    i { font-size: 12px; }
    &:hover:not(:disabled) { background: var(--p-content-hover-background); color: var(--p-text-color); }
    &:disabled { opacity: 0.6; cursor: default; }
    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 1px; }
  }
}

.explorer-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: var(--panel-veil);
}

@media (prefers-reduced-motion: reduce) {
  .explorer,
  .explorer__chevron {
    transition: none;
  }
}
</style>
