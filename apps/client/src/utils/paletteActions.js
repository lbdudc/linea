export const SHORTCUTS = {
  'action:theme': { label: '⌥⇧T', alt: true, shift: true, code: 'KeyT', global: true },
  'action:sidebar': { label: '[' },
  'action:sidebar-filter': { label: '/' },
}

export function matchShortcut(event, shortcut) {
  if (!shortcut?.code) return false
  return event.code === shortcut.code
    && event.altKey === Boolean(shortcut.alt)
    && event.shiftKey === Boolean(shortcut.shift)
    && event.ctrlKey === Boolean(shortcut.ctrl)
    && event.metaKey === false
}

export const isBusy = (productId, { runs = [], jobs = [] } = {}) => {
  const id = String(productId)
  return runs.some((run) => String(run.productId) === id)
    || jobs.some((job) => String(job.productId) === id && ['pending', 'running'].includes(job.status))
}

export const webUrlOf = (product) => product?.repo?.webUrl ?? product?.webUrl ?? null

export const canAct = (product) => Boolean(product) && !product.lineDeleted

export function productActions({ product, t, busy = false, lastOutcome = null, handlers }) {
  const id = String(product._id)
  const name = product.name
  const entry = (key, fields) => ({ id: `product-action:${key}:${id}`, usageKey: `product-action:${key}`, transient: true, ...fields })
  const actions = []

  if (lastOutcome === 'error') {
    actions.push(entry('failed-run', {
        label: t('palette.btn_failed_run'),
      title: t('palette.act_failed_run', { name }),
      caption: t('palette.hint_failed_run'),
      icon: 'pi-exclamation-triangle',
      boost: 300,
      to: `/cicd?productId=${id}&outcome=error`,
      keywords: ['failed', 'error', 'run'],
    }))
  }
  if (canAct(product) && !busy) {
    actions.push(
      entry('generate', {
        label: t('palette.btn_generate'),
        title: t('palette.act_generate', { name }),
        caption: t('palette.hint_generate'),
        icon: 'pi-play',
        run: () => handlers.generate(product),
        keywords: ['generate', 'deploy'],
      }),
      entry('sync', {
        label: t('palette.btn_sync'),
        title: t('palette.act_sync', { name }),
        caption: t('palette.hint_sync'),
        icon: 'pi-sync',
        run: () => handlers.sync(product),
        keywords: ['sync', 'spl'],
      }),
    )
  }
  if (webUrlOf(product)) {
    actions.push(entry('copy-address', {
        label: t('palette.btn_copy_address'),
      title: t('palette.act_copy_address', { name }),
      caption: t('palette.hint_copy_address'),
      icon: 'pi-copy',
      run: () => handlers.copyAddress(product),
      keywords: ['git', 'clone', 'url'],
    }))
    if (product.gitHost !== 'local') {
      actions.push(entry('open-host', {
        label: t('palette.btn_open_host'),
        title: t('palette.act_open_host', { name }),
        caption: t('palette.hint_open_host'),
        icon: 'pi-external-link',
        run: () => handlers.openHost(product),
        keywords: ['git', 'repository', 'web'],
      }))
    }
  }
  return actions
}

export function accountActions({ t, isAdmin, hasLocalAccount, schedulerPaused, handlers }) {
  const actions = [
    { id: 'account:sign-out', title: t('palette.act_sign_out'), caption: t('palette.hint_sign_out'), icon: 'pi-sign-out', run: handlers.signOut, keywords: ['logout', 'log out'] },
    { id: 'account:sessions', title: t('palette.act_sessions'), caption: t('palette.hint_sessions'), icon: 'pi-desktop', run: handlers.sessions, keywords: ['devices', 'sign-ins'] },
  ]
  if (hasLocalAccount) {
    actions.splice(1, 0, { id: 'account:account', title: t('palette.act_account'), caption: t('palette.hint_account'), icon: 'pi-user', run: handlers.account, keywords: ['password', 'profile', 'token'] })
  }
  if (!isAdmin) return actions

  if (schedulerPaused !== null && schedulerPaused !== undefined) {
    actions.push({
      id: 'admin:scheduler',
      title: schedulerPaused ? t('palette.act_scheduler_resume') : t('palette.act_scheduler_pause'),
      caption: t('palette.hint_scheduler'),
      icon: schedulerPaused ? 'pi-play' : 'pi-pause',
      badge: schedulerPaused ? t('scheduler.paused') : t('scheduler.running'),
      effect: schedulerPaused ? t('palette.effect_scheduler_resume') : t('palette.effect_scheduler_pause'),
      run: () => handlers.toggleScheduler(!schedulerPaused),
      keywords: ['scheduler', 'cron', 'pause', 'resume'],
    })
  }
  actions.push(
    { id: 'admin:download-config', title: t('palette.act_download_config'), caption: t('palette.hint_download_config'), icon: 'pi-download', run: handlers.downloadConfig, keywords: ['backup', 'export', 'yaml'] },
    { id: 'admin:add-user', title: t('palette.act_add_user'), caption: t('palette.hint_add_user'), icon: 'pi-user-plus', to: '/settings/users?add=1', keywords: ['account', 'person', 'new'] },
    { id: 'admin:new-module', title: t('palette.act_new_module'), caption: t('palette.hint_new_module'), icon: 'pi-th-large', to: '/packages/modules?new=1', keywords: ['create', 'package'] },
    { id: 'admin:new-metamodel', title: t('palette.act_new_metamodel'), caption: t('palette.hint_new_metamodel'), icon: 'pi-sitemap', to: '/packages/metamodels?new=1', keywords: ['create', 'package'] },
  )
  return actions
}

const TABS = [
  { key: 'issues', label: 'issues.tab', keywords: ['issues', 'bugs'] },
  { key: 'mrs', label: 'mrs.tab', keywords: ['change requests', 'merge requests', 'pull requests'] },
  { key: 'history', label: 'labels.history_tab', productLabel: 'labels.tab_versions', keywords: ['history', 'versions'] },
  { key: 'cicd', label: 'labels.tab_cicd', keywords: ['ci/cd', 'cicd', 'deployments', 'runs'] },
]

export function contextActions({ t, line = null, product = null, pending = [], handlers }) {
  const actions = []
  const lineId = line?._id ?? product?.lineId ?? null
  const subject = product ?? line

  if (lineId) {
    const lineName = line?.name ?? product?.line ?? ''
    actions.push({
      id: 'context:new-product',
      title: t('palette.act_new_product', { name: lineName }),
      caption: t('palette.hint_new_product'),
      icon: 'pi-plus',
      to: `/lines/${lineId}/new-product`,
      keywords: ['new product', 'create product', 'add product'],
    })
  }
  if (subject) {
    const base = product ? `/products/${product._id}` : `/lines/${line._id}`
    for (const tab of TABS) {
      actions.push({
        id: `context:tab-${tab.key}`,
        title: t('palette.act_tab_of', { tab: t(product && tab.productLabel ? tab.productLabel : tab.label), name: subject.name }),
        caption: t('palette.hint_tab'),
        icon: { issues: 'pi-exclamation-circle', mrs: 'pi-code-branch', history: 'pi-history', cicd: 'pi-cloud' }[tab.key],
        to: `${base}?tab=${tab.key}`,
        keywords: tab.keywords,
      })
    }
  }
  if (pending.length) {
    actions.push({
      id: 'context:generate-pending',
      title: t('palette.act_generate_pending'),
      caption: t('palette.hint_generate_pending', { n: pending.length }),
      icon: 'pi-play',
      badge: String(pending.length),
      effect: t('palette.effect_generate_pending', { names: pending.slice(0, 5).map((product) => product.name).join(', ') + (pending.length > 5 ? '…' : '') }),
      run: () => handlers.generatePending(pending),
      keywords: ['generate', 'all', 'pending', 'deploy'],
    })
  }
  return actions
}

export function routeContext(path) {
  const match = /^\/(lines|products)\/([^/]+)/.exec(path)
  return match ? { kind: match[1] === 'lines' ? 'line' : 'product', id: match[2] } : null
}
