import { api } from "../boot/axios";

// An archive travels as the zip itself; an error then comes as a Blob too, so it is read back into what the server said (its `error` code).
const ZIP = { responseType: 'blob', headers: { Accept: 'application/zip' } };
const zipOf = async (request) => {
  try {
    return (await request()).data;
  } catch (error) {
    const body = error.response?.data;
    if (body instanceof Blob) {
      try {
        error.response.data = JSON.parse(await body.text());
      } catch {
        error.response.data = {};
      }
    }
    throw error;
  }
};

export default {
  async createProduct({name, version, lineId}) {
    return (await api.post('/products', {
      lineId,
      spec: {
        basicData: {name, version}
      },
    })).data;
  },

  async duplicateProduct({name, version, spec, lineId}) {
    return (await api.post('/products', {
      lineId,
      spec: {
        ...spec,
        basicData: {...spec.basicData, name, version},
      },
    })).data;
  },

  async createProdWithConfig({name, version, features, lineId}) {
    return (await api.post('/products', {
      lineId,
      spec: {
        basicData: {name, version},
        features: features,
      },
    })).data;
  },

  async findEnrolledLines() {
    return (await api.get(`/products/enrolled`)).data;
  },

  async findProductById({id}) {
    return (await api.get(`/products/${id}`)).data;
  },

  async findInactiveProducts() {
    return (await api.get('/products/inactive')).data;
  },

  async deleteProduct({id}) {
    return (await api.delete(`/products/${id}`)).data;
  },

  // `bump`: 'patch' (default) | 'minor' | 'major' — the part of the version the generation raises.
  async generateProduct({id, bump}) {
    return (await api.post(`/products/${id}/generate`, bump ? {bump} : undefined)).data;
  },

  // What a queue of generations is allowed: { concurrency }, the instance setting of the same name.
  async getGenerationSettings() {
    return (await api.get('/products/generation/settings')).data;
  },

  // Stops the generation of a product while it has not started writing: { status: 'cancelling' | 'committing' | 'idle' }.
  async cancelGeneration({id}) {
    return (await api.post(`/products/${id}/generate/cancel`)).data;
  },

  // The log of a generation with what a person needs to look into it, as a zip (a Blob): its steps and their durations, the spec, the models.
  async downloadGenerationBundle({id, version}) {
    return zipOf(() => api.get(`/products/${id}/versions/${version}/bundle`, ZIP));
  },

  // Puts the code back in line with the SPL without raising the version: the run it made (see SyncRun on the server).
  // `behavior` ('check' | 'mr' | 'merge') overrides what the product is set to do.
  /** The product's changelog and the dependencies of its line that a sync would bring (`lineFrom`/`lineTo`: by default since the last sync). */
  async getChangelog({id, from, to, lineFrom, lineTo}) {
    return (await api.get(`/products/${id}/changelog`, { params: { from, to, lineFrom, lineTo } })).data;
  },

  async syncProduct({id, behavior}) {
    return (await api.post(`/products/${id}/sync`, behavior ? {behavior} : {})).data;
  },

  // The syncs of a product, newest first.
  async listSyncs({id, limit}) {
    return (await api.get(`/products/${id}/syncs`, {params: limit ? {limit} : {}})).data;
  },

  // How the product syncs and generates, and what that comes to once the SPL's defaults are applied.
  async getAutomation({id}) {
    return (await api.get(`/products/${id}/automation`)).data;
  },

  // `sync` and `generation` are partial: only what is sent changes.
  async saveAutomation({id, sync, generation}) {
    return (await api.put(`/products/${id}/automation`, {sync, generation})).data;
  },

  // What a generation would change in the code, without making it:
  // { version, previousVersion, changed, counts: { create, update, delete }, files: [{ path, action, added, removed, diff }], truncated }.
  async previewGeneration({id, bump}) {
    return (await api.post(`/products/${id}/preview`, bump ? {bump} : {})).data;
  },

  // The code derived from `spec`; without it, from the one that is saved. Answers a Blob.
  async generateZip({id, spec}) {
    return zipOf(() => api.post(`/products/${id}/zip`, spec ? {spec} : {}, ZIP));
  },

  // One version with its spec and models, and the version before it: { version, spec, models, previous }.
  // `previous` is the version that came before it, when the caller knows it: it saves looking for it.
  async getVersion({id, version, previous}) {
    return (await api.get(`/products/${id}/versions/${version}`, previous ? { params: { previous } } : undefined)).data;
  },

  // The code that version generated (the archive of its tag). Answers a Blob.
  async versionZip({id, version}) {
    return zipOf(() => api.get(`/products/${id}/versions/${version}/zip`, ZIP));
  },

  // Saves what that version used as the current spec and models. Answers like updateSpec.
  async restoreVersion({id, version}) {
    return (await api.post(`/products/${id}/versions/${version}/restore`)).data;
  },

  // What is saved against what the last generation derived from: { saved, deployed (null if not kept), version, deployedAt }.
  async getDeployment({id}) {
    return (await api.get(`/products/${id}/deployment`)).data;
  },

  // Puts what the last generation used back as the saved one. `parts` limits it ('features', 'fields', 'model:<name>');
  // without it everything goes back. Answers like updateSpec.
  async discardSaved({id, parts}) {
    return (await api.post(`/products/${id}/discard`, parts?.length ? {parts} : undefined)).data;
  },

  async updateSpec({id, spec, importedSpec}) {
    return (await api.patch(`/products/${id}`, importedSpec ? {spec, importedSpec} : {spec})).data;
  },

  async getProductHealth({id}) {
    return (await api.get(`/products/${id}/health`)).data;
  },

  /** Health and open change requests of several products in one request: `{ [id]: { health, conflicts } }`. */
  async restoreProduct({repoId}) {
    return (await api.post('/products/restore', { repoId })).data;
  },

  async getDeletableProducts({ids}) {
    return (await api.get('/products/deletable', { params: { ids: ids.join(',') } })).data;
  },

  async getProductsStatus({ids, features = false, signal}) {
    const params = { ids: ids.join(',') };
    if (features) params.features = 'true';
    return (await api.get('/products/status', { params, signal })).data;
  },

  /** Health, pending changes and (with `pipelines`) the last pipeline of several products in one request: `{ status, deployments, pipelines? }`. */
  async getProductsSummary({ids, pipelines = false, signal}) {
    const params = { ids: ids.join(',') };
    if (pipelines) params.with = 'pipelines';
    return (await api.get('/products/summary', { params, signal })).data;
  },

  /** Which products have saved changes that no generation has deployed, in one request: `{ [id]: { pending, version, restorable } }`. */
  async getProductsDeployments({ids, signal}) {
    return (await api.get('/products/deployments', { params: { ids: ids.join(',') }, signal })).data;
  },

  /** The last pipeline of several products in one request: `{ [id]: { status, webUrl } }`. */
  async getProductsPipelines({ids}) {
    return (await api.get('/products/pipelines', { params: { ids: ids.join(',') } })).data;
  },

  /** The pipeline of the last commit: { pipeline: { id, status, webUrl, createdAt } | null, jobs: [{ id, name, stage, status, duration, webUrl }], failed: { id, name, trace } | null }. */
  async getPipeline({id}) {
    return (await api.get(`/products/${id}/pipeline`)).data;
  },

  /** The open merge requests of the product that have conflicts, with both sides of each file in conflict. */
  async getConflicts({ id }) {
    return (await api.get(`/products/${id}/conflicts`)).data;
  },

  /** Settles the conflicts of one request (`resolutions`: path -> { strategy: 'main' | 'generated' | 'custom', content }) and merges it. */
  async resolveConflicts({ id, number, resolutions }) {
    return (await api.post(`/products/${id}/conflicts/${number}/resolve`, { resolutions })).data;
  },

  /** The pipeline of each version of the history that has one: { [version]: { id, status, webUrl, createdAt } }. */
  async getVersionPipelines({id}) {
    return (await api.get(`/products/${id}/pipelines/by-version`)).data;
  },

  /** The pipeline of each version for several products in one request: `{ [id]: { [version]: pipeline } }`. */
  async getProductsVersionPipelines({ids}) {
    return (await api.get('/products/version-pipelines', { params: { ids: ids.join(',') } })).data;
  },

  /** The jobs of one pipeline (an older one than the last), and what its failed job printed. */
  async getPipelineById({id, pipelineId}) {
    return (await api.get(`/products/${id}/pipelines/${pipelineId}`)).data;
  },

  /** The CI/CD of the product: `{ host, supported, config, rendered, pipelineFile, fileInRepository, runners: { supported, instanceRunners, runners } }`. */
  async getCi({id}) {
    return (await api.get(`/products/${id}/ci`)).data;
  },

  /** Saves the pipeline configuration (it reaches the code with the next generation). Answers like getCi. */
  async saveCi({id, config}) {
    return (await api.put(`/products/${id}/ci`, config)).data;
  },

  /** Turns the runners of the whole instance on or off for the product's repository. Answers its runners. */
  async setCiRunners({id, instanceRunners}) {
    return (await api.put(`/products/${id}/ci/runners`, { instanceRunners })).data;
  },

  /** The merge requests of the generations, newest first: `[{ number, title, version, state, author, createdAt, mergedAt, webUrl, pipeline }]`. */
  async listMergeRequests({id}) {
    return (await api.get(`/products/${id}/merge-requests`)).data;
  },

  /** The merge request of the latest generation with its checks (`null` when there is none yet). */
  async getLatestMergeRequest({id}) {
    return (await api.get(`/products/${id}/merge-requests/latest`)).data;
  },

  /** What a job printed (the end of it): `{ trace }`. */
  async getJobTrace({id, jobId, lines}) {
    return (await api.get(`/products/${id}/jobs/${jobId}/trace`, { params: { lines } })).data;
  },

  /** One merge request with its pipelines, the jobs of the latest and what its failed job printed. */
  async getMergeRequest({id, number}) {
    return (await api.get(`/products/${id}/merge-requests/${number}`)).data;
  },

  /** Runs the failed jobs of the last pipeline again. Answers like getPipeline. */
  async decideUpdate({id, number, decision}) {
    return (await api.post(`/products/${id}/merge-requests/${number}/decision`, {decision})).data;
  },

  async retryPipeline({id}) {
    return (await api.post(`/products/${id}/pipeline/retry`)).data;
  },

  /** Stops a pipeline that has not finished. */
  async cancelPipeline({id, pipelineId}) {
    return (await api.post(`/products/${id}/pipelines/${pipelineId}/cancel`)).data;
  },

  /** Stops one job that has not finished. */
  async cancelJob({id, jobId}) {
    return (await api.post(`/products/${id}/jobs/${jobId}/cancel`)).data;
  },

  async getProductActivity({id}) {
    return (await api.get(`/products/${id}/activity`)).data;
  },

  async getProductConflicts({id}) {
    return (await api.get(`/products/${id}/conflicts`)).data;
  },

  async renameProduct({id, name}) {
    return (await api.post(`/products/${id}/rename`, {name})).data;
  },
};
