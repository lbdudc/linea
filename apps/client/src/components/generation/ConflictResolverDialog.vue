<template>
  <PrimeDialog
    :visible="visible"
    modal
    :header="$t('generation.cr_title')"
    class="conflict-dialog"
    style="width: 980px; max-width: 96vw"
    @update:visible="$emit('update:visible', $event)"
  >
    <div v-if="loading" class="cr__state">
      <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ $t('generation.cr_loading') }}
    </div>
    <div v-else-if="error" class="cr__state cr__state--bad">{{ error }}</div>
    <div v-else-if="!requests.length" class="cr__state">{{ $t('generation.cr_none') }}</div>

    <template v-else>
      <p class="cr__intro">{{ $t('generation.cr_intro') }}</p>

      <section v-for="request in requests" :key="request.number" class="cr__request">
        <header class="cr__request-head">
          <strong>!{{ request.number }} · {{ request.title }}</strong>
          <a v-if="request.webUrl" :href="request.webUrl" target="_blank" rel="noopener" class="cr__link">{{ $t('generation.cr_open_host') }}</a>
        </header>

        <article v-for="file in request.files" :key="file.path" class="cr__file">
          <header class="cr__file-head">
            <code>{{ file.path }}</code>
            <div class="cr__choices" role="radiogroup">
              <label>
                <input type="radio" :name="key(request, file)" value="main" v-model="choices[key(request, file)]" />
                {{ $t('generation.cr_keep_main') }}
              </label>
              <label>
                <input type="radio" :name="key(request, file)" value="generated" v-model="choices[key(request, file)]" />
                {{ $t('generation.cr_use_generated') }}
              </label>
              <label v-if="!file.binary">
                <input type="radio" :name="key(request, file)" value="custom" v-model="choices[key(request, file)]" />
                {{ $t('generation.cr_edit') }}
              </label>
            </div>
          </header>

          <p v-if="file.binary" class="cr__note">{{ $t('generation.cr_binary') }}</p>
          <div v-else class="cr__sides">
            <div class="cr__side" :class="{ 'cr__side--picked': choices[key(request, file)] === 'main' }">
              <span class="cr__side-title">{{ $t('generation.cr_side_main') }}</span>
              <pre>{{ file.mainMissing ? $t('generation.cr_missing') : file.main }}</pre>
            </div>
            <div class="cr__side" :class="{ 'cr__side--picked': choices[key(request, file)] === 'generated' }">
              <span class="cr__side-title">{{ $t('generation.cr_side_generated') }}</span>
              <pre>{{ file.generatedMissing ? $t('generation.cr_missing') : file.generated }}</pre>
            </div>
          </div>

          <textarea
            v-if="choices[key(request, file)] === 'custom'"
            v-model="custom[key(request, file)]"
            class="cr__editor"
            spellcheck="false"
            rows="10"
          />
        </article>

        <footer class="cr__footer">
          <span v-if="request.done" class="cr__done"><i class="pi pi-check" aria-hidden="true" /> {{ $t('generation.cr_done') }}</span>
          <PrimeButton
            v-else
            :label="$t('generation.cr_apply')"
            :loading="applying === request.number"
            :disabled="applying !== null"
            @click="apply(request)"
          />
        </footer>
      </section>
    </template>
  </PrimeDialog>
</template>

<script>
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import productService from 'src/services/productService';

// The merge requests of a product that cannot be merged as they are, with both sides of every file in conflict: for each file the
// person keeps their own version (main), takes the generated one or writes the result; applying it merges the request.
export default {
  name: 'ConflictResolverDialog',
  components: { PrimeDialog: Dialog, PrimeButton: Button },
  props: {
    visible: { type: Boolean, required: true },
    productId: { type: String, required: true },
  },
  emits: ['update:visible', 'resolved'],
  data() {
    return { loading: false, error: '', requests: [], choices: {}, custom: {}, applying: null };
  },
  watch: {
    visible(open) {
      if (open) this.load();
    },
  },
  methods: {
    key(request, file) {
      return `${request.number}:${file.path}`;
    },
    async load() {
      this.loading = true;
      this.error = '';
      try {
        const answer = await productService.getConflicts({ id: this.productId });
        this.requests = (answer.requests ?? []).map((request) => ({ ...request, done: false }));
        const choices = {};
        const custom = {};
        for (const request of this.requests) {
          for (const file of request.files) {
            // the hand-made side is kept unless the person says otherwise
            choices[this.key(request, file)] = file.mainMissing ? 'generated' : 'main';
            custom[this.key(request, file)] = file.main ?? file.generated ?? '';
          }
        }
        this.choices = choices;
        this.custom = custom;
      } catch (e) {
        this.error = this.$t(e.response?.data?.error || 'error_messages.internal_error');
      } finally {
        this.loading = false;
      }
    },
    async apply(request) {
      this.applying = request.number;
      try {
        const resolutions = {};
        for (const file of request.files) {
          const k = this.key(request, file);
          resolutions[file.path] = this.choices[k] === 'custom'
            ? { strategy: 'custom', content: this.custom[k] }
            : { strategy: this.choices[k] };
        }
        const answer = await productService.resolveConflicts({ id: this.productId, number: request.number, resolutions });
        request.done = Boolean(answer.merged);
        if (!answer.merged) this.error = this.$t('generation.cr_not_merged');
        else this.$emit('resolved', request.number);
      } catch (e) {
        this.error = this.$t(e.response?.data?.error || 'error_messages.internal_error');
      } finally {
        this.applying = null;
      }
    },
  },
};
</script>

<style scoped>
.cr__state { padding: 24px; text-align: center; color: var(--p-text-muted-color); }
.cr__state--bad { color: var(--status-bad, #ef4444); }
.cr__intro { margin: 0 0 12px; color: var(--p-text-muted-color); }
.cr__request { border: 1px solid var(--p-content-border-color, rgba(255, 255, 255, 0.12)); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.cr__request-head, .cr__file-head, .cr__footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.cr__link { font-size: 0.85rem; }
.cr__file { margin-top: 12px; }
.cr__choices { display: flex; gap: 14px; font-size: 0.9rem; }
.cr__sides { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.cr__side { border: 1px solid var(--p-content-border-color, rgba(255, 255, 255, 0.12)); border-radius: 6px; padding: 6px; min-width: 0; }
.cr__side--picked { border-color: var(--p-primary-color, #3b82f6); }
.cr__side-title { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--p-text-muted-color); }
.cr__side pre { margin: 4px 0 0; max-height: 220px; overflow: auto; font-size: 0.8rem; white-space: pre-wrap; word-break: break-word; }
.cr__editor { width: 100%; margin-top: 8px; font-family: monospace; font-size: 0.85rem; }
.cr__note { color: var(--p-text-muted-color); font-size: 0.85rem; }
.cr__footer { margin-top: 12px; justify-content: flex-end; }
.cr__done { color: var(--status-ok, #22c55e); }
@media (max-width: 720px) { .cr__sides { grid-template-columns: 1fr; } }
</style>
