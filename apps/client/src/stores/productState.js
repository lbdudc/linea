import { reactive } from 'vue';

const initialBasicData = () => ({
  name: '',
  version: '',
  database: {},
  extra: {},
  testEnvironment: { image: '', command: '' },
  languages: ['en', 'es', 'gl'],
  createdAt: '',
  SRID: '4326'
});

// The spec of the product being looked at, as the page edits it: the basic data and the statics. Its features are the index of its feature
// selection (a model of the feature metamodel, edited with the rest of its models): they are kept as the server has them, and saved back as they are.
const store = reactive({
  basicData: initialBasicData(),
  statics: [],
  features: [],
  // What older products stored for models that are no longer edited here (a class diagram, a sensor DSL). They are kept as they were and
  // saved back with the rest, so that saving a product does not lose them: they still take part in its generation.
  preserved: {},
  loaded: false,

  load(json, loadBasicData = true) {
    if (loadBasicData) {
      this.basicData.name = json.basicData?.name || '';
      this.basicData.version = json.basicData?.version || '';
    }

    this.basicData.database = json.basicData?.database || {};
    this.basicData.extra = json.basicData?.extra || {};
    this.preserved = Object.fromEntries(['dataModel', 'sensor'].filter((key) => json[key] !== undefined).map((key) => [key, json[key]]));
    this.basicData.testEnvironment = json.basicData?.testEnvironment || { image: '', command: '' };
    this.basicData.createdAt = json.basicData?.createdAt || '';
    this.basicData.SRID = json.basicData?.SRID || '4326';
    this.basicData.languages =
      json.basicData?.languages?.length > 0
        ? json.basicData.languages
        : ['en', 'es', 'gl'];
    this.statics = json.statics || [];
    this.features = Array.isArray(json.features) ? [...json.features] : [];

    this.loaded = true;
  },

  clear() {
    this.basicData = initialBasicData();
    this.statics = [];
    this.features = [];
    this.preserved = {};
    this.loaded = false;
  },

  getSpec() {
    return Object.assign({
      basicData: this.basicData,
      features: this.features,
      statics: this.statics
    }, this.preserved);
  }
});

export default store;
