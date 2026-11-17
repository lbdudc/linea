
import './boot/polyfills';

import { createApp } from 'vue';

import App from './App.vue';
import router, { hasLiveSession } from './router';
import { usePortfolio } from './composables/usePortfolio';
import { installI18n, i18n } from './boot/i18n';
import { installPluginGuard } from './plugins/host';
import { installAxios } from './boot/axios';
import { installPrimeVue } from './boot/primevue';
import { applyHostWords } from './boot/hostWords';

import './css/app.scss';

const app = createApp(App);

installI18n(app);
installAxios(app);
installPrimeVue(app);

// the words of the git host in use (GitHub's pull requests, say), once the server has said which it is
applyHostWords({ i18n });
installPluginGuard({ router, i18n });
app.use(router);

// the lines and products start loading now, not when the first page that shows them has been built: with a session that has not run
// out, the first screen is drawn from what this browser kept and the answer is on its way meanwhile
if (hasLiveSession() && !window.location.pathname.startsWith('/login')) usePortfolio({ statuses: false });

app.mount('#app');

// Once the first page is up and the browser has nothing else to do, the code of the pages people move between is fetched, so going from
// one to another never waits for a download. The model editor (about 8 MB with Monaco) is left out: it loads when it is opened.
const PREFETCH = [
  () => import('pages/IndexPage.vue'),
  () => import('pages/LineManagement.vue'),
  () => import('pages/ProductManagement.vue'),
  () => import('pages/LineDetail.vue'),
  () => import('pages/ProductDetail.vue'),
  () => import('pages/DeploymentsPage.vue'),
];
router.isReady().then(() => {
  if (navigator.connection?.saveData) return;
  const idle = window.requestIdleCallback ?? ((run) => setTimeout(run, 1500));
  idle(async () => {
    for (const load of PREFETCH) {
      try { await load(); } catch { /* it is fetched when the page is opened */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });
});

