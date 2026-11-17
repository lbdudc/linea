<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import PageHeader from 'components/layout/PageHeader.vue'
import { sections, sectionOf } from 'components/settings/sections'
import { useT } from 'src/composables/useT'

const t = useT()
const route = useRoute()

const current = computed(() => sectionOf(route.params.section) ?? sections[0])
</script>

<template>
  <div class="configuration">
    <PageHeader :title="t('configuration.title')" :subtitle="t('configuration.subtitle')" />

    <div class="configuration__body">
      <nav class="configuration__sections" :aria-label="t('configuration.sections')">
        <router-link
          v-for="section in sections"
          :key="section.key"
          :to="`/settings/${section.key}`"
          class="configuration__section"
          :class="{ 'configuration__section--active': section.key === current.key }"
          :data-section="section.key"
        >
          <i :class="['pi', section.icon]" aria-hidden="true" />
          {{ t(section.labelKey) }}
        </router-link>
      </nav>

      <component :is="current.component" :key="current.key" class="configuration__content" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.configuration {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px;

  &__body {
    display: flex;
    gap: 32px;
    align-items: flex-start;
  }

  &__sections {
    flex-shrink: 0;
    width: 200px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__section {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 6px;
    color: var(--p-text-muted-color);
    text-decoration: none;

    &:hover {
      background: var(--p-content-hover-background);
    }

    &--active {
      background: var(--p-highlight-background);
      color: var(--p-highlight-color);
      font-weight: 500;
    }
  }

  &__content {
    flex: 1;
    min-width: 0;
  }

  @media (max-width: 800px) {
    &__body {
      flex-direction: column;
      gap: 16px;
    }

    &__sections {
      width: 100%;
      flex-direction: row;
      overflow-x: auto;
    }
  }
}
</style>
