<script setup>
import { computed } from 'vue'
import Message from 'primevue/message'
import Tag from 'primevue/tag'

// A changelog as the server gives it (`/changelog`): its sections with the commits that made each change, the incompatible ones marked, and,
// for something made of modules, the dependencies whose version changes with what each of them brings.
const props = defineProps({
  changelog: { type: Object, required: true },
  // the dependencies are shown here or left to the caller
  showDependencies: { type: Boolean, default: true },
  // inside another block (a dependency): no frame of its own
  flat: { type: Boolean, default: false },
})

const sections = computed(() => props.changelog.sections ?? [])
const dependencies = computed(() => props.changelog.dependencies ?? [])
const breakingCount = computed(() => sections.value.find((s) => s.id === 'breaking')?.entries.length ?? 0)
const isEmpty = computed(() => !sections.value.length && !dependencies.value.length)
const linkOf = (url) => (/^https?:\/\//i.test(url ?? '') ? url : null)
const refLabel = (r) => `${r.kind === 'issue' ? '#' : '!'}${r.number}`

// The entries by version, the oldest first: what each version brought, with the commits behind it.
const compare = (a, b) => {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}
const groups = computed(() => {
  const versions = new Map()
  for (const section of sections.value) {
    for (const entry of section.entries ?? []) {
      const key = entry.version ?? ''
      if (!versions.has(key)) versions.set(key, new Map())
      const bySection = versions.get(key)
      if (!bySection.has(section.id)) bySection.set(section.id, { id: section.id, entries: [] })
      bySection.get(section.id).entries.push(entry)
    }
  }
  return [...versions.entries()]
    .sort(([a], [b]) => (a && b ? compare(a, b) : a ? 1 : -1))
    .map(([version, bySection]) => ({ version, sections: [...bySection.values()] }))
})
// the colour of the tag of each kind of change
const SEVERITY = { breaking: 'danger', features: 'success', fixes: 'info', performance: 'warn', other: 'secondary' }
const countOf = (group) => group.sections.reduce((n, s) => n + s.entries.length, 0)

// a heading per version only when there is more than one
const showVersions = computed(() => groups.value.filter((g) => g.version).length > 1)

// metamodels and modules apart
const KINDS = [{ kind: 'metamodel', icon: 'pi pi-sitemap' }, { kind: 'module', icon: 'pi pi-th-large' }]
const dependencyGroups = computed(() => {
  const known = KINDS.map((k) => ({ ...k, items: dependencies.value.filter((d) => d.kind === k.kind) }))
  const others = dependencies.value.filter((d) => !KINDS.some((k) => k.kind === d.kind))
  return [...known, { kind: 'other', icon: 'pi pi-box', items: others }].filter((g) => g.items.length)
})
</script>

<template>
  <div class="changelog" :class="{ 'changelog--flat': flat }" data-test="changelog">
    <Message v-if="breakingCount || changelog.breaking" severity="warn" :closable="false" data-test="changelog-breaking">
      {{ $t('changelog.breaking_warning') }}<template v-if="breakingCount"> · {{ $t('changelog.breaking_count', { n: breakingCount }) }}</template>
    </Message>
    <p v-if="changelog.truncated" class="changelog__quiet">{{ $t('changelog.truncated') }}</p>
    <p v-if="isEmpty" class="changelog__quiet" data-test="changelog-empty">{{ $t('changelog.empty') }}</p>

    <article v-for="group in groups" :key="group.version" class="cl-version" :data-test="`changelog-version-${group.version || 'none'}`">
      <header v-if="showVersions && group.version" class="cl-version__head">
        <h3 class="changelog__version-title">v{{ group.version }}</h3>
        <span class="cl-count">{{ countOf(group) }}</span>
      </header>
      <div class="cl-version__body">
        <section v-for="section in group.sections" :key="section.id" class="cl-section" :data-test="`changelog-section-${section.id}`">
          <Tag :severity="SEVERITY[section.id] ?? 'secondary'" :value="$t(`changelog.section_${section.id}`)" class="cl-section__tag" />
          <ul role="list" class="cl-entries">
            <li v-for="(entry, i) in section.entries" :key="`${entry.shortId}-${i}`" class="cl-entry">
              <span class="cl-entry__text">
                <span v-if="entry.scope" class="cl-scope">{{ entry.scope }}</span>
                <span>{{ entry.description }}</span>
                <span v-if="entry.breakingNote && entry.breakingNote !== entry.description" class="changelog__note"> — {{ entry.breakingNote }}</span>
              </span>
              <span class="cl-entry__refs">
                <template v-for="r in entry.references ?? []" :key="`${r.kind}${r.number}`">
                  <a v-if="linkOf(r.webUrl)" :href="linkOf(r.webUrl)" target="_blank" rel="noopener noreferrer" class="cl-commit cl-commit--ref">{{ refLabel(r) }}</a>
                  <span v-else class="cl-commit cl-commit--ref">{{ refLabel(r) }}</span>
                </template>
                <a v-if="linkOf(entry.webUrl)" :href="linkOf(entry.webUrl)" target="_blank" rel="noopener noreferrer" class="cl-commit" data-test="commit-link"><i class="pi pi-code" />{{ entry.shortId }}</a>
                <span v-else-if="entry.shortId" class="cl-commit"><i class="pi pi-code" />{{ entry.shortId }}</span>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </article>

    <section v-for="group in (showDependencies ? dependencyGroups : [])" :key="group.kind" class="cl-deps" :data-test="`changelog-dependencies-${group.kind}`">
      <h4 class="cl-deps__title"><i :class="group.icon" /> {{ group.kind === 'other' ? $t('changelog.dependencies') : $t(`changelog.kind_${group.kind}`) }}</h4>
      <article v-for="d in group.items" :key="d.location" class="cl-dep">
        <header class="cl-dep__head">
          <span class="cl-dep__name">{{ d.name }}</span>
          <span v-if="d.change === 'added' || d.change === 'removed'" class="cl-move">{{ $t(`changelog.dep_${d.change}`) }} v{{ d.change === 'added' ? d.to : d.from }}</span>
          <span v-else class="cl-move">v{{ d.from }}<i class="pi pi-arrow-right" />v{{ d.to }}</span>
          <Tag v-if="d.changelog?.breaking" severity="danger" :value="$t('changelog.breaking_warning')" />
          <span v-if="d.error" class="changelog__quiet">{{ $t('changelog.dep_unavailable') }}</span>
        </header>
        <div v-if="d.changelog && d.changelog.sections?.length" class="cl-dep__body">
          <ChangelogView :changelog="d.changelog" :show-dependencies="false" flat />
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped lang="scss">
.changelog { display: flex; flex-direction: column; gap: 18px; font-size: 13.5px; line-height: 1.5; min-width: 0; }
.changelog--flat { gap: 12px; }
.changelog__quiet { margin: 0; color: var(--p-text-muted-color); font-size: 12px; }
.changelog__note { color: var(--p-text-muted-color); }

// a version: a framed block with its own head
.cl-version { display: flex; flex-direction: column; border: 1px solid var(--p-content-border-color); border-radius: 10px; overflow: hidden; background: var(--p-content-background); }
.changelog--flat .cl-version { border: 0; border-radius: 0; background: transparent; overflow: visible; }
.cl-version__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; background: var(--p-content-hover-background); border-bottom: 1px solid var(--p-content-border-color); }
.changelog__version-title { margin: 0; font-size: 14px; font-weight: 700; font-family: var(--font-mono, ui-monospace, monospace); letter-spacing: .01em; }
.cl-count { min-width: 22px; padding: 1px 7px; border-radius: 999px; text-align: center; font-size: 11px; font-weight: 600; color: var(--p-text-muted-color); background: var(--p-content-background); border: 1px solid var(--p-content-border-color); }
.cl-version__body { display: flex; flex-direction: column; gap: 16px; padding: 14px 16px 16px; }
.changelog--flat .cl-version__body { padding: 0; }
.changelog--flat .cl-version__head { padding: 0 0 6px; background: transparent; border: 0; }

// a kind of change: its tag, then one row per commit
.cl-section { display: flex; flex-direction: column; gap: 8px; }
.cl-section__tag { align-self: flex-start; font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.cl-entries { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.cl-entry { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 7px 2px; border-top: 1px solid var(--p-content-border-color); }
.cl-entry:first-child { border-top: 0; }
.cl-entry__text { min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 8px; }
.cl-scope { padding: 0 7px; border-radius: 5px; font-size: 11.5px; font-weight: 600; font-family: var(--font-mono, ui-monospace, monospace); color: var(--p-primary-color); background: color-mix(in srgb, var(--p-primary-color) 12%, transparent); }
.cl-entry__refs { flex: none; display: inline-flex; align-items: center; gap: 6px; }
.cl-commit { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 6px; font-size: 11.5px; font-family: var(--font-mono, ui-monospace, monospace); color: var(--p-text-muted-color); background: var(--p-content-hover-background); border: 1px solid var(--p-content-border-color); text-decoration: none; i { font-size: 10px; } }
a.cl-commit { color: var(--p-primary-color); cursor: pointer; transition: background-color .15s, border-color .15s; }
a.cl-commit:hover { background: color-mix(in srgb, var(--p-primary-color) 12%, transparent); border-color: var(--p-primary-color); }
a.cl-commit:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 2px; }
.cl-commit--ref { font-size: 11px; }

// dependencies: metamodels and modules apart, a block per dependency
.cl-deps { display: flex; flex-direction: column; gap: 10px; }
.cl-deps__title { margin: 4px 0 0; display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--p-text-muted-color); i { font-size: 12px; } }
.cl-dep { border: 1px solid var(--p-content-border-color); border-left: 3px solid var(--p-primary-color); border-radius: 10px; background: var(--p-content-background); }
.cl-dep__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 11px 16px; }
.cl-dep__name { font-weight: 700; font-family: var(--font-mono, ui-monospace, monospace); font-size: 13.5px; }
.cl-move { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-family: var(--font-mono, ui-monospace, monospace); color: var(--p-text-muted-color); i { font-size: 10px; } }
.cl-dep__body { padding: 2px 16px 16px; border-top: 1px solid var(--p-content-border-color); padding-top: 14px; }

@media (max-width: 520px) { .cl-entry { flex-direction: column; gap: 4px; } }
</style>
