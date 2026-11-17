import { api } from "../boot/axios";

let configRequest = null;

export default {
  async tryLoginUserFromServiceToken() {
    return (await api.post('/users/loginFromServiceToken')).data;
  },

  // `host` says which git host gave the code
  async loginUserFromGitLab({ code, host }) {
    return (await api.post(`/users/login/${host}`, { code })).data;
  },

  /** Signs in with the username and password of an account made on this server (the `local` git host). */
  async loginLocal({ username, password }) {
    return (await api.post('/users/login/local', { username, password })).data;
  },

  /** Adds an account on another git host to who is signed in. Answers the hosts they have now. */
  async linkIdentity({ host, code }) {
    return (await api.post(`/users/identities/${host}`, { code })).data;
  },

  async unlinkIdentity({ host }) {
    return (await api.delete(`/users/identities/${host}`)).data;
  },

  /** Chooses the git host the app shows (the profile). Answers the hosts they have and the one in use. */
  async setProfile({ host }) {
    return (await api.put('/users/profile', { host })).data;
  },

  /** The person's own sign-ins (one per browser or device); `current` marks this one. */
  async sessions() {
    return (await api.get('/users/me/sessions')).data;
  },

  async endSession(id) {
    await api.delete(`/users/me/sessions/${id}`);
  },

  /** Ends every sign-in but this one. */
  async endOtherSessions() {
    await api.delete('/users/me/sessions', { params: { others: true } });
  },

  /** Ends every sign-in, this one too. */
  async endAllSessions() {
    await api.delete('/users/me/sessions');
  },

  /** The hosts the server has on. The boot step and the sign-in page both ask: one request, kept until `forgetConfig`. */
  getConfig() {
    configRequest ??= api.get('/users/config').then(({ data }) => data).catch((error) => {
      configRequest = null;
      throw error;
    });
    return configRequest;
  },

  /** The next `getConfig` asks the server again (an administrator changed the hosts). */
  forgetConfig() {
    configRequest = null;
  },

  async logout() {
    try {
      await api.post('/users/logout');
    } catch {
      // best-effort: local state is cleared regardless
    }
  },
};
