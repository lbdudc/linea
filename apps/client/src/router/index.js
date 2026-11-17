import { createRouter, createWebHistory } from 'vue-router';
import routes from './routes';
import { state } from "stores/userState";

const router = createRouter({
  history: createWebHistory(),
  routes
});

if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

router.afterEach((to, from) => {
  if (to.path === from.path) return;
  const container = document.querySelector('.app-main');
  if (container) container.scrollTop = 0;
});

// The payload of the stored session token, without checking it (the server does): enough to know whom it is for and whether it ran out.
const storedSession = () => {
  try {
    const payload = JSON.parse(atob(localStorage.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000 > Date.now() + 60_000 ? payload : null;
  } catch {
    return null;
  }
};

// whether there is a stored session token that has not run out (what the app may start asking for data with, before it is confirmed)
export const hasLiveSession = () => storedSession() !== null;

// Configuration pages (the plugins, the git hosts, the people) are for administrators; the server refuses everyone else anyway.
export const refusesNonAdmin = (to, user) => to.matched.some((record) => record.meta.requiresAdmin) && !user?.admin;

router.beforeEach((to, from, next) => {
  const isAuthenticated = state.token !== null && state.user !== null;
  const allow = () => (refusesNonAdmin(to, state.user) ? next({ path: '/' }) : next());

  if (!to.matched.some(record => record.meta.requiresAuth)) {
    next();
    return;
  }

  if (isAuthenticated) {
    allow();
    return;
  }

  const toLogin = () => next({ path: '/login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } });

  // Whether the person is an administrator is only known once the session is restored: a page for administrators waits for it.
  const needsUser = to.matched.some((record) => record.meta.requiresAdmin);

  // A token that has not run out is good for the requests the page is about to make (the server keeps every unexpired one): show the page
  // now and renew the session beside it (App does) instead of making the first screen wait for that round trip. When the server turns
  // out to refuse it, the 401 handler and App send the person to the login page as before.
  if (storedSession() && !needsUser) {
    next();
    return;
  }

  // A stored token is first exchanged for a session: the login page is for when there is none (or it ran out), not for every
  // page load. Imported here because the session service depends on the axios boot, which depends on this router.
  if (localStorage.token) {
    import('../services/session.js')
      .then(({ restoreSession }) => restoreSession())
      .then((restored) => (restored ? allow() : toLogin()))
      .catch(toLogin);
    return;
  }

  toLogin();
});

export default router;
