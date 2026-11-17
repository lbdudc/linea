import { h, ref, onMounted } from 'vue';

// What the page and the widget show: they ask the plugin's own route through `ui.api` (base `/api`, with the session).
const component = (ui, title) => ({
  name: 'HelloGreeting',
  inheritAttrs: false, // a slot hands its context (the model text, say) to the component: this one has no use for it as attributes
  setup() {
    const data = ref(null);
    const failed = ref(false);
    onMounted(async () => {
      try { data.value = (await ui.api.get('/plugins/hello-plugin/greeting')).data; } catch { failed.value = true; }
    });
    return () => h('div', { class: 'hello-plugin', style: 'padding: 16px' }, [
      h('h2', title),
      h('p', failed.value ? '—' : data.value ? `${data.value.greeting}, ${data.value.user}! (${data.value.generated} products generated)` : '…'),
    ]);
  },
});

export default {
  register(ui) {
    ui.addNav({ id: 'hello', icon: 'pi-sparkles', label: { en: 'Hello', es: 'Hola', gl: 'Ola' }, to: '/hello' });
    ui.addRoute({ path: '/hello', name: 'hello-plugin:home', component: component(ui, 'Hello') });
    ui.addSlot('featureModel.panels', component(ui, 'Hello panel'), { id: 'hello-plugin:panel', order: 50 });
  },
};
