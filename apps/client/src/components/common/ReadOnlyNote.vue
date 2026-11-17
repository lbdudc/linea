<template>
  <p class="readonly-note" name="cicd-read-only">
    <i class="pi pi-lock" aria-hidden="true" /> {{ $t('cicd.read_only_note') }}
  </p>
</template>

<style scoped>
.readonly-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--surface-alt);
  color: var(--text-muted);
  font-size: 0.8125rem;
}
</style>
