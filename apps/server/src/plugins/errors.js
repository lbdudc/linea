// Errors carry a `code` so onError can answer them (it looks the code up before the class name).
class PluginError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class PluginNotFoundError extends PluginError {
  constructor(id) {
    super('PLUGIN_NOT_FOUND', `There is no plugin "${id}" in the catalog.`);
  }
}

export class PluginDisabledError extends PluginError {
  constructor(id) {
    super('PLUGIN_DISABLED', `The plugin "${id}" is not enabled.`);
    this.pluginId = id;
  }
}

export class PluginIncompatibleError extends PluginError {
  constructor(id, requires, have) {
    super('PLUGIN_INCOMPATIBLE', `The plugin "${id}" needs LINEA ${requires}; this is ${have}.`);
  }
}

export class PluginStateError extends PluginError {
  constructor(id, message) {
    super('PLUGIN_STATE', message ?? `The plugin "${id}" is not in a state that allows this.`);
  }
}
