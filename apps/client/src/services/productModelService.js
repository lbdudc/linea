import { api } from "../boot/axios";

/** The models of a product: what it is configured with (its feature selection among them) and the editors of the others. */
export default {
  /** `summary`: only how each model stands (the overview), without what an editor needs (grammars, what modules offer, layouts). */
  async getProductModels({ id, summary = false }) {
    return (await api.get(`/products/${id}/models`, summary ? { params: { summary: true } } : undefined)).data;
  },

  /** Adapts the stored models to the current metamodels of the SPL (drops the ones of removed metamodels, seeds new ones) */
  async syncProductModels({ id }) {
    return (await api.post(`/products/${id}/models/sync`)).data;
  },

  /** `layouts` (where the nodes of the diagrams were left) is saved in the same commit when given */
  async saveProductModel({ id, metamodel, content, layouts }) {
    return (await api.put(`/products/${id}/models/${metamodel}`, layouts === undefined ? { content } : { content, layouts })).data;
  },

  async saveProductLayouts({ id, layouts }) {
    return (await api.put(`/products/${id}/layouts`, { layouts })).data;
  },
};
