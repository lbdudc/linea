import { reactive } from 'vue';

const state = reactive({
  user: null,
  token: null
});

const setUserData = (userData) => {
  state.user = userData.user;
  state.token = userData.token;
};

const clearUserData = () => {
  state.user = null;
  state.token = null;
};

export { state, setUserData, clearUserData };
