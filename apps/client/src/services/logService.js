import { api } from "../boot/axios";

export default {
  async find({id, version}) {
    return (await api.get(`/logs/${id}/${version}`)).data;
  },

  async findVersions({id}) {
    return (await api.get(`/logs/${id}/versions`)).data;
  },

  async getMetrics() {
    return (await api.get('/logs/metrics')).data;
  },

  async listDeployments(params = {}) {
    return (await api.get('/logs/deployments', { params })).data;
  },
};
