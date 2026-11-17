<script setup>
import { ref } from 'vue'
import Avatar from 'primevue/avatar'
import PrimeButton from 'primevue/button'
import { renderMarkdown } from 'src/utils/markdown'
import { relativeShort } from 'src/utils/relativeTime'
import MarkdownEditor from 'components/issues/MarkdownEditor.vue'

// A conversation of a merge request, as GitLab draws it: the messages in a box, then a place to answer and, for one about the code,
// the button that resolves it.
const props = defineProps({
  thread: { type: Object, required: true },
  // the host lets a thread of the code be resolved
  canResolve: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['reply', 'resolve'])

const replying = ref(false)
const draft = ref('')
const initial = (name) => String(name ?? '?').charAt(0).toUpperCase()
const ago = (at) => relativeShort(at)

const send = () => {
  const body = draft.value.trim()
  if (!body) return
  emit('reply', { threadId: props.thread.id, body })
  draft.value = ''
  replying.value = false
}
</script>

<template>
  <div class="tbox ln-fields" :class="{ 'tbox--resolved': thread.resolved }" name="mr-thread">
    <article v-for="comment in thread.comments" :key="comment.id" class="tbox__note">
      <Avatar :label="initial(comment.author)" shape="circle" size="small" />
      <div class="tbox__main">
        <header class="tbox__head"><b>{{ comment.author }}</b><span>{{ ago(comment.createdAt) }}</span></header>
        <div class="tbox__body issue-md" v-html="renderMarkdown(comment.body)" />
      </div>
    </article>

    <div v-if="replying" class="tbox__reply">
      <MarkdownEditor v-model="draft" :rows="3" :placeholder="$t('mrs.comment_placeholder')" />
      <div class="tbox__actions">
        <PrimeButton size="small" :label="$t('mrs.comment')" :disabled="!draft.trim()" :loading="busy" @click="send" />
        <PrimeButton size="small" severity="secondary" text :label="$t('mrs.cancel_comment')" @click="replying = false" />
      </div>
    </div>
    <footer v-else class="tbox__foot">
      <PrimeButton size="small" severity="secondary" outlined :label="$t('mrs.reply')" @click="replying = true" />
      <PrimeButton
        v-if="canResolve && thread.resolvable" size="small" severity="secondary" text :icon="thread.resolved ? 'pi pi-replay' : 'pi pi-check-circle'"
        :label="thread.resolved ? $t('mrs.unresolve') : $t('mrs.resolve')" :loading="busy" name="mr-thread-resolve" @click="emit('resolve', { threadId: thread.id, resolved: !thread.resolved })"
      />
      <span v-if="thread.resolved" class="tbox__done"><i class="pi pi-check-circle" aria-hidden="true" /> {{ $t('mrs.resolved') }}</span>
    </footer>
  </div>
</template>

<style scoped>
.tbox { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--card-border); border-radius: 8px; background: var(--card-bg); min-width: 0; font-size: 0.875rem; white-space: normal; font-family: var(--font-body, inherit); }
.tbox--resolved { opacity: 0.8; border-color: color-mix(in srgb, var(--status-ok) 40%, var(--card-border)); }
.tbox__note { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; }
.tbox__head { display: flex; gap: 8px; align-items: baseline; font-size: 0.75rem; color: var(--text-muted); }
.tbox__head b { color: var(--text-heading); font-size: 0.8125rem; }
.tbox__body { line-height: 1.5; overflow-wrap: anywhere; }
.tbox__reply { display: flex; flex-direction: column; gap: 8px; }
.tbox__actions, .tbox__foot { display: flex; align-items: center; gap: 8px; }
.tbox__done { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; font-size: 0.75rem; color: var(--status-ok); }
</style>
