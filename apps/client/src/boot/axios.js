import axios from 'axios'
import router from '../router/index.js'
import { portfolioFreshness, changesPortfolio } from '../stores/portfolioFreshness.js'
import { setUserData } from '../stores/userState.js'
import { requestStarted, requestEnded } from '../stores/slowRequests.js'
import { forgetRecentReads } from '../stores/recentReads.js'
import { isMissingEntityResponse, isForbiddenEntityResponse, markMissing } from '../stores/missingEntity.js'

const api = axios.create({ baseURL: `${process.env.API_URL || ''}/api` })

const onRequest = (config) => {
  const token = localStorage.token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // only a read: what writes and runs (a generation, a sync, an analysis) takes long by design and shows its own progress
  if (String(config.method ?? 'get').toLowerCase() === 'get') requestStarted(config);
  return config;
};

api.interceptors.request.use(onRequest, (error) => Promise.reject(error));

const onResponseSuccess = (response) => {
  requestEnded(response.config);
  // a line or a product was made, changed or removed: the lists the app holds are reloaded
  if (changesPortfolio({ method: response.config?.method, url: response.config?.url })) {
    forgetRecentReads();
    portfolioFreshness.changed();
  }
  return response;
};

// The git host's access token runs out (or was rotated by a renewal that was under way): the server renews it when the session is
// restored. A request that failed for that is asked again once with the renewed session, so the page never shows the failure.
// Everything that fails at the same time shares one renewal (the host rotates the refresh token on each use).
let renewing = null;
const renewSession = () => {
  renewing ??= api.post('/users/loginFromServiceToken')
    .then(({ data }) => {
      setUserData(data);
      localStorage.setItem('token', data.token);
      return data.token;
    })
    .finally(() => { renewing = null; });
  return renewing;
};

const onAuthenticationError = async (error) => {
  requestEnded(error.config);
  const isGitlabAuth = error.response?.data?.code === 'GIT_HOST_AUTH';
  const config = error.config;
  if (isGitlabAuth && config && !config.renewed && config.url !== '/users/loginFromServiceToken' && localStorage.token) {
    try {
      await renewSession();
    } catch {
      return Promise.reject(error);
    }
    return api({ ...config, renewed: true, headers: { ...config.headers, Authorization: undefined } });
  }
  if (!isGitlabAuth && error.response && error.response.status === 401 && error.config.url !== "/users/loginFromServiceToken" && localStorage.token) {
    localStorage.removeItem('token');
    router.push("/login");
  }
  // the page is about an id the server does not know: the layout shows "not found" instead of an empty page
  const route = router.currentRoute.value;
  if (error.response && isMissingEntityResponse({ status: error.response.status, url: error.config?.url }, route)) markMissing(route.path);
  else if (error.response && isForbiddenEntityResponse({ status: error.response.status, url: error.config?.url }, route)) markMissing(route.path, 'forbidden');
  return Promise.reject(error);
};

api.interceptors.response.use(onResponseSuccess, onAuthenticationError);

export function installAxios (app) {
  app.config.globalProperties.$axios = axios

  app.config.globalProperties.$api = api
}

export { api }
