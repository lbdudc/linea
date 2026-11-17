<script setup>
import { computed, ref, watch } from 'vue'
import Skeleton from 'primevue/skeleton'
import GenerationResultDialog from 'src/components/generation/GenerationResultDialog.vue'
import logService from 'src/services/logService'
import productService from 'src/services/productService'
import { notify } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import { hostRunsPipelines } from 'stores/gitHosts'
import { pastRunOf } from 'src/utils/pastRun'

// The three steps of a generation that already ran, told as when it was generated, in the place of a page.
const props = defineProps({
  run: { type: Object, required: true },
  /** The merge requests of the product, newest first. */
  requests: { type: Array, required: true },
  host: { type: String, default: null },
})
defineEmits(['rollback', 'decided'])
const t = useT()

const loaded = ref(null)
watch(() => props.run.id, async () => {
  const { id, productId, version } = props.run
  loaded.value = null
  const [logs, pipelines] = await Promise.all([
    logService.find({ id: productId, version }).catch(() => []),
    productService.getVersionPipelines({ id: productId }).catch(() => ({})),
  ])
  if (props.run.id === id) loaded.value = { logs, pipelines }
}, { immediate: true })

const runs = computed(() => {
  if (!loaded.value) return []
  const { run, requests } = props
  const request = requests.find((candidate) => candidate.kind === 'generation' && candidate.version === run.version)
  const latest = requests.find((candidate) => candidate.kind === 'generation')
  const past = pastRunOf({
    productId: run.productId,
    name: run.productName,
    version: run.version,
    logs: loaded.value.logs,
    outcome: run.outcome,
    deployable: !props.host || hostRunsPipelines(props.host),
    pipeline: request?.pipeline ?? loaded.value.pipelines?.[run.version] ?? null,
    checksRequest: request?.pipeline ? request.number : null,
    historic: true,
    checksOpen: request?.state === 'opened' && (Boolean(request.awaitingDecision) || ['failed', 'canceled'].includes(request.pipeline?.status)),
  })
  return [{ ...past, historic: past.status === 'error' || latest?.version !== run.version }]
})
const onError = (code) => notify({ type: 'negative', message: t(code) })
</script>

<template>
  <Skeleton v-if="!runs.length" height="20rem" name="run-steps-loading" />
  <GenerationResultDialog
    v-else
    embedded
    visible
    :runs="runs"
    @rollback="$emit('rollback', $event)"
    @decided="$emit('decided', $event)"
    @error="onError"
  />
</template>
