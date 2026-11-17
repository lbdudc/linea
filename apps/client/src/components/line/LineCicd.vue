<script setup>
import { ref } from 'vue'
import CicdFrame from 'components/cicd/CicdFrame.vue'
import CicdStatus from 'components/cicd/CicdStatus.vue'
import LineSyncSettings from './LineSyncSettings.vue'
import LineSplPipeline from './LineSplPipeline.vue'
import ReadOnlyNote from 'components/common/ReadOnlyNote.vue'

// The CI/CD of a line: what its generations and syncs are doing, and how they are set up (what its products inherit for syncing, and the
// checks of the repository of the SPL).
defineProps({ lineId: { type: String, required: true } })
const mode = ref('status')
const syncReadOnly = ref(false)
const checksReadOnly = ref(false)
</script>

<template>
  <div class="ln-panel" name="line-cicd">
    <CicdFrame v-model="mode" v-slot="{ period }">
      <CicdStatus v-if="mode === 'status'" :line-id="lineId" :period="period" />
      <div v-else class="line-cicd__config" name="line-cicd-config">
        <ReadOnlyNote v-if="syncReadOnly || checksReadOnly" />
        <LineSyncSettings :line-id="lineId" @read-only="syncReadOnly = $event" />
        <LineSplPipeline :line-id="lineId" @read-only="checksReadOnly = $event" />
      </div>
    </CicdFrame>
  </div>
</template>

<style scoped>
.line-cicd__config { display: flex; flex-direction: column; gap: 14px; }
</style>
