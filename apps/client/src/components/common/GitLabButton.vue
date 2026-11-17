<script>
import Button from 'primevue/button'
import Tooltip from 'primevue/tooltip'
import GitHostIcon from 'components/common/GitHostIcon.vue'
import { hostName } from 'src/boot/gitHost'
import { gitHosts } from 'stores/gitHosts'
import { notify } from 'src/composables/useNotify'

export default {
  name: 'GitLabButton',
  components: { PrimeButton: Button, GitHostIcon },
  directives: { tooltip: Tooltip },
  props: {
    id:   { type: Number },
    href: { type: String },
    type: { type: String },
    text: { type: Boolean, default: false },
    // the git host of what it opens (the primary one when not said)
    host: { type: String, default: null },
  },
  computed: {
    hostId() {
      return this.host || gitHosts.primary || 'gitlab'
    },
    hostLabel() {
      return hostName(this.hostId)
    },
    // the repositories of this server's own host have no page to open: what there is to take from them is their git address
    copiesAddress() {
      return this.hostId === 'local' && this.type === 'repository'
    },
    repositoryTip() {
      return this.copiesAddress ? this.$t('labels.copy_git_url') : this.hostLabel
    },
    buttonName() {
      return this.text ? `spl-${this.type}` : `spl-${this.type}-${this.id}`
    },
  },
  methods: {
    async handleClick() {
      if (this.copiesAddress) {
        try {
          await navigator.clipboard.writeText(`${this.href}.git`)
          notify({ type: 'positive', message: this.$t('labels.git_url_copied') })
        } catch {
          notify({ type: 'negative', message: `${this.href}.git` })
        }
        return
      }
      window.open(this.href, '_blank')
    },
  },
}
</script>

<template>
  <!-- Code / Web IDE -->
  <PrimeButton
    v-if="type === 'code' && href"
    text
    :rounded="!text"
    size="small"
    :label="text ? $t('labels.web_ide') : undefined"
    :name="buttonName"
    class="gitlab-btn gitlab-btn--muted" style="margin-right: 4px"
    v-tooltip="{ value: $t('labels.web_ide'), disabled: text }"
    @click="handleClick"
  >
    <template #icon>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
        <path d="M10.478 1.647a.5.5 0 1 0-.956-.294l-4 13a.5.5 0 0 0 .956.294l4-13zM4.854 4.146a.5.5 0 0 1 0 .708L1.707 8l3.147 3.146a.5.5 0 0 1-.708.708l-3.5-3.5a.5.5 0 0 1 0-.708l3.5-3.5a.5.5 0 0 1 .708 0zm6.292 0a.5.5 0 0 0 0 .708L14.293 8l-3.147 3.146a.5.5 0 0 0 .708.708l3.5-3.5a.5.5 0 0 0 0-.708l-3.5-3.5a.5.5 0 0 0-.708 0z"/>
      </svg>
    </template>
  </PrimeButton>

  <!-- Repository -->
  <PrimeButton
    v-else-if="type === 'repository'"
    text
    :rounded="!text"
    size="small"
    :label="text ? repositoryTip : undefined"
    :name="buttonName"
    class="gitlab-btn gitlab-btn--brand" style="margin-right: 4px"
    v-tooltip="{ value: repositoryTip, disabled: text }"
    @click="handleClick"
  >
    <template #icon>
      <GitHostIcon :host="hostId" :size="14" />
    </template>
  </PrimeButton>
</template>

<style scoped lang="scss">
.gitlab-btn {
  &--muted {
    color: var(--text-muted) !important;
  }

  &--brand {
    color: var(--gitlab-color-text) !important;
  }
}
</style>
