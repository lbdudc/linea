<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import { slotItems, localized } from 'src/plugins/registry'
import { useLineProducts } from 'src/composables/usePortfolio'
import { modelTabs } from 'components/modules/modulesTab'

// The tabs of a line, the same on each of its pages: products and activity are views of the line itself, the modules and the
// feature model are pages of their own. The side bar leads to the same places.
import { pluginTabKey } from 'src/plugins/lineTabs'

const props = defineProps({
  id: { type: String, required: true },
  active: { type: String, required: true },
})

const router = useRouter()
const { line, own, failing } = useLineProducts(() => props.id)

const tabs = computed(() => [
  { key: 'products', labelKey: 'modules.tab_products', path: `/lines/${props.id}?tab=products`, count: line.value ? own.value.length : null, alert: failing.value > 0 },
  ...modelTabs(props.id, line.value, props.active).map(({ key, labelKey, path }) => ({ key, labelKey, path })),
  // what enabled plugins add to a line (`line.tabs`): their `when` sees the line, so a tab can be for some kinds only
  ...slotItems('line.tabs', { lineId: props.id, line: line.value, kind: line.value?.kind }).map((item) => ({
    key: pluginTabKey(item), rawLabel: item.label || item.plugin, path: `/lines/${props.id}?tab=${pluginTabKey(item)}`,
  })),
  { key: 'mrs', labelKey: 'mrs.tab', path: `/lines/${props.id}?tab=mrs` },
  { key: 'issues', labelKey: 'issues.tab', path: `/lines/${props.id}?tab=issues` },
  { key: 'history', labelKey: 'labels.history_tab', path: `/lines/${props.id}?tab=history` },
  { key: 'cicd', labelKey: 'labels.tab_cicd', path: `/lines/${props.id}?tab=cicd` },
])

const open = (key) => {
  if (key === props.active) return
  const target = tabs.value.find((t) => t.key === key)
  if (target) router.push(target.path)
}
</script>

<template>
  <Tabs :value="active" class="line-tabs" @update:value="open">
    <TabList>
      <Tab v-for="t in tabs" :key="t.key" :value="t.key" :name="`tab-${t.key}`">
        {{ t.rawLabel ? localized(t.rawLabel, $i18n.locale) : $t(t.labelKey) }}
        <span v-if="t.count !== null && t.count !== undefined" class="line-tabs__count">{{ t.count }}</span>
        <span v-if="t.alert" class="line-tabs__alert" aria-hidden="true" />
      </Tab>
    </TabList>
  </Tabs>
</template>

<style scoped>
.line-tabs { flex-shrink: 0; }
.line-tabs :deep(.p-tablist) { background: transparent; border: none; }
.line-tabs :deep(.p-tablist-tab-list) { background: transparent; border-bottom: none; }
.line-tabs :deep(.p-tab) { margin-right: 20px; padding: 11px 0; background: transparent; border: none; font-size: 13px; color: var(--p-text-muted-color); gap: 6px; }
.line-tabs :deep(.p-tab:hover) { color: var(--p-text-color); }
.line-tabs :deep(.p-tab-active) { color: var(--p-text-color); font-weight: 500; }
.line-tabs :deep(.p-tablist-active-bar) { height: 2px; background: var(--p-primary-color); }
.line-tabs__count { margin-left: 6px; padding: 0 6px; border-radius: 10px; background: var(--p-content-hover-background); font-size: 11px; color: var(--p-text-secondary-color); }
.line-tabs__alert { margin-left: 6px; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--status-bad); }
</style>
