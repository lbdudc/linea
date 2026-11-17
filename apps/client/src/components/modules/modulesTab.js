import { reactive } from 'vue'

const moduleCounts = reactive({})
const asked = new Set()

export const rememberLineModules = (id, info) => {
  moduleCounts[id] = Object.keys(info?.spl?.modules ?? {}).length
}

export const lineModulesCount = (id) => {
  if (!(id in moduleCounts) && !asked.has(id)) {
    asked.add(id)
    import('src/services/packageService')
      .then(({ default: packageService }) => packageService.getLineModules({ id }))
      .then((info) => rememberLineModules(id, info))
      .catch(() => {})
  }
  return moduleCounts[id] ?? 0
}

export const forgetLineModules = () => {
  for (const id of Object.keys(moduleCounts)) delete moduleCounts[id]
  asked.clear()
}

const tab = (key, icon, labelKey, path) => ({ key, icon, labelKey, path })

export const modelTabs = (id, line, active) => {
  const base = `/lines/${id}`
  const modules = tab('modules', 'pi-box', 'modules.tab_modules', `${base}/modules`)
  if (line?.kind === 'project') {
    const withModules = active === 'modules' || lineModulesCount(id) > 0
    return [
      tab('metamodels', 'pi-th-large', 'modules.tab_metamodels', `${base}/metamodels`),
      tab('model', 'pi-sitemap', 'modules.tab_feature_model', `${base}/model`),
      ...(withModules ? [modules] : []),
    ]
  }
  if (line?.modular) return [modules, tab('model', 'pi-sitemap', 'modules.tab_model', `${base}/model`)]
  return [...(active === 'modules' ? [modules] : []), tab('model', 'pi-sitemap', 'modules.tab_model', `${base}/model`)]
}
