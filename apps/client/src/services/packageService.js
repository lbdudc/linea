import { api } from '../boot/axios';


/**
 * Modules and metamodels (packages of the registry) and the modules of a line.
 * `kind` is `module` or `metamodel`; a package's `id` is its GitLab project id.
 */
export default {
  async list({ kind }) {
    return (await api.get(`/packages/${kind}`)).data;
  },

  async create({ kind, name, description, namespaceId, register }) {
    return (await api.post(`/packages/${kind}`, { name, description, namespaceId, register })).data;
  },

  /** What the versions of a package after `from` up to `to` bring, by its location (`gitlab:group/name`). */
  async getChangelog({ kind, location, from, to }) {
    return (await api.get(`/packages/${kind}/changelog`, { params: { location, from, to } })).data;
  },

  /** `{ configured, location }`: whether this LINEA lists the packages of a registry (otherwise: every package with the topic of its kind). */
  async registryStatus() {
    return (await api.get(`/registry/status`)).data;
  },

  /** Packages of the git host that are not in the registry yet. */
  async registrySuggestions({ kind }) {
    return (await api.get(`/registry/suggestions`, { params: { kind } })).data;
  },

  /** Adds a package, by its location (`gitlab:group/name`), to the registry. */
  async register({ location }) {
    return (await api.post(`/registry`, { location })).data;
  },

  async unregister({ location }) {
    await api.delete(`/registry`, { params: { location } });
  },

  async get({ kind, id }) {
    return (await api.get(`/packages/${kind}/${id}`)).data;
  },

  async readFile({ kind, id, path, ref }) {
    return (await api.get(`/packages/${kind}/${id}/file`, { params: { path, ref } })).data;
  },

  async saveFile({ kind, id, path, content, message }) {
    return (await api.put(`/packages/${kind}/${id}/file`, { path, content, message })).data;
  },

  /** Several files of a package in one commit: `files` is `{ path: content }`, and `null` deletes a file. */
  async saveFiles({ kind, id, files, message }) {
    return (await api.put(`/packages/${kind}/${id}/files`, { files, message })).data;
  },

  /** What the metamodel studio edits: `{ metamodel, files, dependencies, paths, diagnostics }` (see the server's `studio.js`). */
  async getStudio({ kind, id }) {
    return (await api.get(`/packages/${kind}/${id}/studio`)).data;
  },

  async deleteFile({ kind, id, path }) {
    return (await api.delete(`/packages/${kind}/${id}/file`, { params: { path } })).data;
  },

  async check({ kind, id }) {
    return (await api.post(`/packages/${kind}/${id}/check`)).data;
  },

  async publish({ kind, id, bump }) {
    return (await api.post(`/packages/${kind}/${id}/publish`, { bump })).data;
  },

  // ── the modules of a line ──────────────────────────────────────────────────
  async getLineModules({ id }) {
    return (await api.get(`/lines/${id}/modules`)).data;
  },

  /** `metamodels` checks the metamodels of a project the same way. */
  async checkLineModules({ id, modules, metamodels, signal }) {
    return (await api.post(`/lines/${id}/modules/check`, { ...(modules ? { modules } : {}), ...(metamodels ? { metamodels } : {}) }, { signal })).data;
  },

  /** `{ location, lines: [{ id, name, kind, direct, range, version, products }] }`: the lines that use a package, and at which version. */
  async usage({ kind, id }) {
    return (await api.get(`/packages/${kind}/${id}/usage`)).data;
  },

  // the same check for an SPL that does not exist yet
  async previewModules({ name, modules, signal }) {
    return (await api.post(`/lines/modules/preview`, { name, modules }, { signal })).data;
  },

  // the same check for a project that does not exist yet: the metamodels the person chose (the feature metamodel is always in)
  async previewMetamodels({ name, kind = 'project', metamodels, signal }) {
    return (await api.post(`/lines/metamodels/preview`, { name, kind, metamodels }, { signal })).data;
  },

  /** The modules of a modular line and/or the metamodels of a project: the whole set, as it is to be. */
  async saveLineModules({ id, modules, metamodels, bump }) {
    return (await api.put(`/lines/${id}/modules`, { ...(modules ? { modules } : {}), ...(metamodels ? { metamodels } : {}), ...(bump ? { bump } : {}) })).data;
  },
};
