module.exports = modelTransformation;

var _metamodelProcessors = [];

function registerMetamodelProcessor(fn) {
  _metamodelProcessors.push(fn);
}

function modelTransformation(input) {
  if (input.data && input.data.basicData) return input;

  let ret = {};
  ret.features = input.features;
  ret.data = Object.assign({}, modelData(input));
  ret.data.basicData = ret.data.basicData
    ? withVersion(ret.data.basicData, input.basicData)
    : basicData(input.basicData);

  _metamodelProcessors.forEach(function(processor) {
    processor(ret, input);
  });

  ret.data.gui = Object.assign(gui(ret.features, ret.data.basicData.name), ret.data.gui);
  ret.data.menus = Array.isArray(ret.data.menus) && ret.data.menus.length ? ret.data.menus : menus(ret);
  ret.data.statics = ret.data.statics !== undefined ? ret.data.statics : statics(input.statics);
  return ret;
}

function modelData(input) {
  return input.models && input.models.data ? input.models.data : {};
}

function withVersion(fromModels, given) {
  const ret = Object.assign({}, fromModels);
  if (ret.version === undefined && given && given.version !== undefined) ret.version = given.version;
  return ret;
}

function normalize(str, upper) {
  return str
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/[^\w\s]/gi, "")
    .replace(/\s(.)/g, function ($1) {
      return $1.toUpperCase();
    })
    .replace(/\s/g, "")
    .replace(/^(.)/, function ($1) {
      return upper ? $1.toUpperCase() : $1.toLowerCase();
    });
}

function basicData(input) {
  return {
    index: {
      component: "STATIC",
      view: "welcome",
    },
    languages: input.languages || [],
    name: input.name,
    packageInfo: {
      artifact: normalize(input.name).toLowerCase(),
      group: input.packageGroup || "com.example",
    },
    database: input.database,
    extra: input.extra,
    SRID: input.SRID,
    version: input.version,
  };
}

function gui(features, name) {
  const ret = {
    settings: {
      font: { family: "Arial", size: "14px" },
      colorset: ["#fff", "#eee", "#777", "#555", "#577492", "#333", "#222"],
      header: { type: "Text", text: name },
    },
  };

  if (features.indexOf("GUI_M_Top") !== -1) {
    ret.design = "1";
  } else if (features.indexOf("GUI_M_Left") !== -1) {
    ret.design = "5";
  } else if (features.indexOf("GUI_M_Right") !== -1) {
    ret.design = "6";
  } else {
    ret.design = "4";
  }
  if (features.indexOf("GUI_M_Top") !== -1 && features.indexOf("GUI_M_Left") !== -1) {
    ret.design = "2";
  }
  if (features.indexOf("GUI_M_Top") !== -1 && features.indexOf("GUI_M_Right") !== -1) {
    ret.design = "3";
  }

  return ret;
}

function statics(input) {
  return input;
}

function menus(product) {
  const ret = [];

  switch (product.data.gui.design) {
    case "1": ret.push({ id: "top", elements: [] }); break;
    case "2": ret.push({ id: "top", elements: [] }); ret.push({ id: "left", elements: [] }); break;
    case "3": ret.push({ id: "top", elements: [] }); ret.push({ id: "right", elements: [] }); break;
    case "4": return [];
    case "5": ret.push({ id: "left", elements: [] }); break;
    case "6": ret.push({ id: "right", elements: [] }); break;
  }

  if (product.data.lists && product.features.indexOf("GUI_Lists") !== -1) {
    ret[0].elements.push(listMenu(product.data.lists));
  }
  ret[0].elements.push(listComponents(product.features));

  if (product.features.indexOf("UserManagement") !== -1) {
    ret[0].elements.push(listUserManagement(product.features));
  }

  return ret;
}

function listMenu(lists) {
  return {
    id: "Lists",
    type: "MENU",
    elements: lists.map((l) => ({
      id: l.id,
      type: "VIEW",
      view: { component: "LIST", view: l.id },
    })),
    access: { admin: true, logged: true },
  };
}

function listComponents(features) {
  return {
    id: "Components",
    type: "MENU",
    elements: features
      .filter((f) => featureMenu(f, features))
      .map((f) => featureMenu(f, features)),
    access: { admin: true, logged: true },
  };
}

function featureMenu(feature, features) {
  // Add cases for your platform's features here
  // Example: case "MY_FEATURE": return view("MY_COMPONENT", "My View");
  return null;
}

function listUserManagement(features) {
  const list = [];
  let aux;

  if (features.indexOf("UM_Authentication") !== -1) {
    aux = view("USER_MANAGEMENT", "Sign in");
    aux.access = { anonymous: true };
    list.push(aux);
  }
  if (features.indexOf("UM_R_Anonymous") !== -1) {
    aux = view("USER_MANAGEMENT", "Registration");
    aux.access = { anonymous: true };
    list.push(aux);
  }
  if (features.indexOf("UM_UP_ByUser") !== -1) {
    aux = view("USER_MANAGEMENT", "Change password");
    aux.access = { admin: true, logged: true };
    list.push(aux);
  }
  if (features.indexOf("UM_UserProfile") !== -1) {
    aux = view("USER_MANAGEMENT", "Profile details");
    aux.access = { admin: true, logged: true };
    list.push(aux);
  }
  if (features.indexOf("UM_UserSessions") !== -1) {
    aux = view("USER_MANAGEMENT", "Sessions");
    aux.access = { admin: true, logged: true };
    list.push(aux);
  }
  if (features.indexOf("UM_UserCRUD") !== -1) {
    aux = view("USER_MANAGEMENT", "User Management");
    aux.access = { admin: true };
    list.push(aux);
  }
  if (features.indexOf("UM_Authentication") !== -1) {
    aux = view("USER_MANAGEMENT", "Exit");
    aux.access = { admin: true, logged: true };
    list.push(aux);
  }

  return { id: "Account", type: "MENU", elements: list };
}

function view(comp, view) {
  return {
    id: view,
    type: "VIEW",
    view: { component: comp, view: view },
  };
}
