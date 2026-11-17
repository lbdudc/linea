import { api } from "../boot/axios";
import { recentRead } from "../stores/recentReads.js";

export default {
  /** `kind`: plain (the feature metamodel only), project (also the `metamodels` chosen: location -> range) or modular (made of `modules`). */
  async createLine({name, version, description, kind = 'plain', metamodels, modules, parentNamespaceId, host}) {
    return (await api.post('/lines', {
      name,
      version,
      description,
      kind,
      parentNamespaceId,
      ...(host ? { host } : {}),
      ...(metamodels ? { metamodels } : {}),
      ...(modules ? { modules } : {}),
    })).data;
  },

  /** Who works on the line (local host lines: the owner manages them here). */
  async listMembers(id) {
    return (await api.get(`/lines/${id}/members`)).data;
  },

  async setMember(id, username, role) {
    return (await api.put(`/lines/${id}/members/${encodeURIComponent(username)}`, { role })).data;
  },

  async removeMember(id, username) {
    return (await api.delete(`/lines/${id}/members/${encodeURIComponent(username)}`)).data;
  },

  /** What the products of the line inherit for syncing, and how many follow it, have their own, or are off. */
  async getSync(id) {
    return (await api.get(`/lines/${id}/sync`)).data;
  },

  async saveSync(id, sync) {
    return (await api.put(`/lines/${id}/sync`, { sync })).data;
  },

  /** The syncs of every product of the line, newest first. */
  async listSyncs(id) {
    return (await api.get(`/lines/${id}/syncs`)).data;
  },

  /** The merge requests of all its products, tagged `kind: 'sync' | 'generation'`. */
  async listMergeRequests(id) {
    return (await api.get(`/lines/${id}/merge-requests`)).data;
  },

  /** The CI of the repository of the line: { host, supported, config, rendered, pipelineFile, fileInRepository }. */
  async getCi(id) {
    return (await api.get(`/lines/${id}/ci`)).data;
  },

  async saveCi(id, config) {
    return (await api.put(`/lines/${id}/ci`, config)).data;
  },

  async findEnrolledLines() {
    return (await api.get('/lines/enrolled')).data;
  },

  /** GitLab groups the user may create a line's group under. */
  // `host`: the git host to list the groups of (the primary one without it)
  async findAvailableNamespaces(host) {
    return (await api.get('/lines/namespaces', { params: host ? { host } : {} })).data;
  },

  // a page and its shell asking for the same line at once share one request (each gets its own copy: they edit what they get)
  async findLineById({id}) {
    const asked = recentRead(`line:${id}`, () => api.get(`/lines/${id}`).then((answer) => answer.data));
    return JSON.parse(JSON.stringify(await asked));
  },

  async restoreLine({repoId, productRepoIds}) {
    return (await api.post('/lines/restore', { repoId, productRepoIds })).data;
  },

  async getDeletableLines({ids}) {
    return recentRead(`deletable:${ids.join(',')}`, () => api.get('/lines/deletable', { params: { ids: ids.join(',') } }).then((answer) => answer.data));
  },

  async findInactiveLines() {
    return (await api.get('/lines/inactive')).data;
  },

  async deleteLine({id, keepProductIds = []}) {
    return (await api.delete(`/lines/${id}`, { data: { keepProductIds } })).data;
  },

  /** What a version (or the range after `from` up to `to`) brings: `{ from, to, versions, sections, breaking, truncated, markdown, dependencies }`. */
  async getChangelog({id, from, to}) {
    return (await api.get(`/lines/${id}/changelog`, { params: { from, to } })).data;
  },

  /** The versions of a line, newest first: `{ current, versions: [{ version, savedAt, kept, modular, modules, current }] }`. */
  async getVersions({id}) {
    return (await api.get(`/lines/${id}/versions`)).data;
  },

  /** One version with what it was, and the one before it (or `previous`): `{ version, savedAt, modular, featureModel, modules, previous }`. */
  async getVersion({id, version, previous}) {
    return (await api.get(`/lines/${id}/versions/${version}`, previous ? { params: { previous } } : undefined)).data;
  },

  async getFeatureModel({id}) {
    return (await api.get(`/lines/${id}/model`)).data;
  },

  /** What a feature model (a model of the feature metamodel) would be in the line: `{ ok, diagnostics, uvl }`. Nothing is saved. */
  async previewFeatureModel({id, content, metamodel, signal}) {
    return (await api.post(`/lines/${id}/model/preview`, { content, ...(metamodel ? { metamodel } : {}) }, { signal })).data;
  },

  async saveFeatureModel({id, content, bump, metamodel}) {
    return (await api.put(`/lines/${id}/model`, { content, ...(bump ? { bump } : {}), ...(metamodel ? { metamodel } : {}) })).data;
  },
};
