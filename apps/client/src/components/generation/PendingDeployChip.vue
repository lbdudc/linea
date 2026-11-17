<template>
  <span v-if="deployment?.pending" class="pending-chip">
    <button
      type="button"
      class="pending-chip__button"
      name="product-pending-deploy"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="pending-chip__dot" aria-hidden="true" />
      {{ $t('generation.pending') }}
    </button>

    <Popover ref="popover" @show="open = true" @hide="open = false">
      <div class="pending-pop" role="dialog" name="pending-deploy-banner" :aria-label="$t('generation.pending_title')">
        <div class="pending-pop__text">
          <span class="pending-pop__title">{{ $t('generation.pending_title') }}</span>
          <span class="pending-pop__desc">{{ $t('generation.pending_desc', { version: deployment.version }) }}</span>
        </div>

        <div class="pending-pop__actions">
          <template v-if="deployment.restorable">
            <template v-if="!confirming">
              <PrimeButton
                text size="small"
                :label="$t('generation.diff_action')"
                name="pending-deploy-diff"
                @click="emitAndClose('diff')"
              >
                <template #icon><i class="pi pi-arrow-right-arrow-left" style="font-size: 12px" aria-hidden="true" /></template>
              </PrimeButton>
              <PrimeButton
                text rounded size="small" severity="danger"
                icon="pi pi-undo"
                :aria-label="$t('generation.discard_action')"
                v-tooltip.bottom="$t('generation.discard_action')"
                :disabled="busy"
                name="pending-deploy-discard"
                @click="confirming = true"
              />
            </template>
            <template v-else>
              <span class="pending-pop__confirm">{{ $t('generation.discard_confirm') }}</span>
              <PrimeButton text size="small" :label="$t('labels.cancel')" name="pending-deploy-discard-cancel" @click="confirming = false" />
              <PrimeButton
                size="small" severity="danger"
                :label="$t('generation.discard_yes')"
                :loading="busy"
                name="pending-deploy-discard-confirm"
                @click="confirm"
              />
            </template>
          </template>
          <PrimeButton
            v-if="!confirming"
            size="small"
            :label="$t('generation.pending_action')"
            :disabled="disabled"
            name="pending-deploy-generate"
            @click="emitAndClose('generate')"
          >
            <template #icon><i class="pi pi-play" style="font-size: 12px" aria-hidden="true" /></template>
          </PrimeButton>
        </div>
      </div>
    </Popover>
  </span>
</template>

<script>
import Button from 'primevue/button';
import Popover from 'primevue/popover';
import Tooltip from 'primevue/tooltip';

// Saved changes that no generation has put in the code of the product yet: a small tag next to the version, on every tab, that
// opens what can be done about it. It takes no room of its own, unlike a banner.
export default {
  name: 'PendingDeployChip',
  components: { PrimeButton: Button, Popover },
  directives: { tooltip: Tooltip },
  props: {
    // { pending, version, restorable } as the server reports it
    deployment: { type: Object, default: null },
    disabled: { type: Boolean, default: false },
    // a discard is on its way
    busy: { type: Boolean, default: false },
  },
  emits: ['generate', 'diff', 'discard'],
  data() {
    return { open: false, confirming: false };
  },
  methods: {
    toggle(event) {
      this.confirming = false;
      this.$refs.popover.toggle(event);
    },
    emitAndClose(name) {
      this.$refs.popover.hide();
      this.$emit(name);
    },
    confirm() {
      this.$emit('discard');
      this.confirming = false;
      this.$refs.popover.hide();
    },
  },
};
</script>

<style scoped lang="scss">
.pending-chip {
  display: inline-flex;

  // The same measures as the validity tag it sits next to (dot, padding, size, radius), so the two read as a pair.
  &__button {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
    padding: 3px 11px;
    border: 1px solid var(--status-warn-border);
    border-radius: 20px;
    background: var(--status-warn-soft);
    color: var(--status-warn);
    font: inherit;
    font-size: 12px;
    line-height: 1.5;
    cursor: pointer;

    &:hover { border-color: var(--status-warn); }
    &:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 2px; }
  }

  &__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    background: currentColor;
  }
}

.pending-pop {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 340px;
  max-width: calc(100vw - 48px);

  &__text { display: flex; flex-direction: column; gap: 2px; }
  &__title { font-weight: 600; font-size: 0.875rem; color: var(--text-heading); }
  &__desc { font-size: 0.8125rem; color: var(--text-muted); }

  &__actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
  }

  &__confirm { font-size: 0.8125rem; color: var(--text-heading); margin-right: 4px; }
}
</style>
