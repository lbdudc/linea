import { api } from '../boot/axios';

// What a feature model means for the products of a line: checked by the validator, not asked of a model.
export default {
  async status({ lineId, signal }) {
    return (await api.get(`/migration/lines/${lineId}/status`, { signal })).data;
  },

  /** `content`: the feature model of a line with its own file; `modules`: the modules of a line made of them. */
  async impact({ lineId, content, modules, metamodels }) {
    return (await api.post(`/migration/lines/${lineId}/impact`, modules || metamodels ? { ...(modules ? { modules } : {}), ...(metamodels ? { metamodels } : {}) } : { content })).data;
  },
};
