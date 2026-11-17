import userService from './userService';
import { state, setUserData, clearUserData } from 'stores/userState';
import { socket, connect } from '../boot/ws';

// One restore of the session at a time, shared by whoever needs to know whether there is one (the router, before it decides to show
// the login page, and the app shell). A stored token is exchanged for a fresh one; only when that fails is the person logged out.
let pending = null;

const isOAuthCallback = () => new URLSearchParams(window.location.search).has('code');

export const restoreSession = () => {
  if (state.token && state.user) return Promise.resolve(true);
  if (pending) return pending;
  // a fresh OAuth callback is the login form's job; it replaces whatever token is stored
  if (!localStorage.token || isOAuthCallback()) return Promise.resolve(false);

  pending = userService.tryLoginUserFromServiceToken()
    .then((userData) => {
      setUserData(userData);
      localStorage.setItem('token', userData.token);
      connect();
      socket.emit('auth', userData.token);
      return true;
    })
    .catch(() => {
      // the stored session is no longer usable (expired JWT, revoked GitLab token)
      localStorage.removeItem('token');
      clearUserData();
      return false;
    })
    .finally(() => { pending = null; });
  return pending;
};

// A session that is in use is renewed before its token runs out, so it only ends when the person leaves.
const RENEW_EVERY_MS = 30 * 60 * 1000;
let timer = null;

export const keepSessionAlive = () => {
  if (timer) return;
  timer = setInterval(async () => {
    if (!state.token || document.visibilityState === 'hidden') return;
    try {
      const userData = await userService.tryLoginUserFromServiceToken();
      setUserData(userData);
      localStorage.setItem('token', userData.token);
      socket.emit('auth', userData.token);
    } catch {
      // the next request that needs the session finds out and sends the person to log in
    }
  }, RENEW_EVERY_MS);
};
