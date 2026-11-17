function pluralize(name) {
  return name + "s";
}

function capitalizeOneWord(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function camelToSnakeCase(str) {
  return str[0].toLowerCase() + str.slice(1, str.length).replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
}

function normalizeKebabCase(str) {
  return str
    .replace(/[\s-]+/g, '-')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function normalizeSnakeCase(str) {
  return str
    .replace(/[\s-]+/g, '_')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function normalizeUrl(str) {
  return str
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .trim()
    .replace(/[\s]/g, "-")
    .toLowerCase();
}

function getDatabaseConfigFromSpec(data, name, defaultValue) {
  var dataBase = data.basicData.database;
  if (dataBase) {
    if (dataBase[name] && dataBase[name] != "") {
      return dataBase[name];
    }
  }
  return defaultValue;
}

function getExtraConfigFromSpec(data, name, defaultValue) {
  var extra = data.basicData.extra;
  if (extra) {
    if (extra[name] && extra[name] != "") {
      return extra[name];
    }
  }
  return defaultValue;
}
