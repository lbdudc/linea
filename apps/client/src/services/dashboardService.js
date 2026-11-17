import { api } from "../boot/axios";

export default {
  async get({ days = 14, lineId } = {}) {
    // `tz`: minutes west of UTC, so the days of the chart are the ones on the wall of this browser
    return (await api.get('/dashboard', { params: { days, tz: new Date().getTimezoneOffset(), ...(lineId ? { lineId } : {}) } })).data;
  },
};
