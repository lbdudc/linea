// The git hosts a LINEA can use and what each one is set with. A host is configured, not installed: `gitHosts:` of linea.config.yml, the
// environment (GITLAB_*, GITHUB_*, LINEA_REPOS_DIR) or the Settings page of an administrator. The schemas are those of plugin settings
// (see settings.js): the form that edits them is the same.

/** `local` keeps the repositories on this server, so LINEA works without any other git host. */
export const HOST_SCHEMAS = {
  local: {
  "dataDir": {
    "type": "string",
    "env": "LINEA_REPOS_DIR",
    "default": "./.data/repos",
    "label": {
      "en": "Folder of the repositories",
      "es": "Carpeta de los repositorios",
      "gl": "Cartafol dos repositorios"
    },
    "description": {
      "en": "Where LINEA keeps the repositories of the lines and products made on this server.",
      "es": "Donde LINEA guarda los repositorios de las líneas y productos hechos en este servidor.",
      "gl": "Onde LINEA garda os repositorios das liñas e produtos feitos neste servidor."
    }
  },
  "defaultNamespace": {
    "type": "string",
    "default": "",
    "public": true,
    "label": {
      "en": "Group new SPLs go to",
      "es": "Grupo donde se crean las SPL",
      "gl": "Grupo onde se crean as SPL"
    },
    "description": {
      "en": "Empty: the last one used.",
      "es": "Vacío: el último usado.",
      "gl": "Baleiro: o último usado."
    }
  }
},
  gitlab: {
  "url": {
    "type": "url",
    "env": "GITLAB_HOSTNAME",
    "required": true,
    "public": true,
    "label": {
      "en": "GitLab address",
      "es": "Dirección de GitLab",
      "gl": "Enderezo de GitLab"
    },
    "description": {
      "en": "The GitLab people sign in with and lines live on, e.g. https://gitlab.example.com.",
      "es": "El GitLab con el que se entra y donde viven las líneas, p. ej. https://gitlab.example.com.",
      "gl": "O GitLab co que se entra e onde viven as liñas, p. ex. https://gitlab.example.com."
    }
  },
  "clientId": {
    "type": "string",
    "env": "GITLAB_CLIENT_ID",
    "required": true,
    "label": {
      "en": "OAuth application ID",
      "es": "ID de la aplicación OAuth",
      "gl": "ID da aplicación OAuth"
    }
  },
  "clientSecret": {
    "type": "secret",
    "env": "GITLAB_SECRET_ID",
    "required": true,
    "label": {
      "en": "OAuth application secret",
      "es": "Secreto de la aplicación OAuth",
      "gl": "Segredo da aplicación OAuth"
    }
  },
  "redirectUri": {
    "type": "url",
    "env": "GITLAB_REDIRECT_URI",
    "label": {
      "en": "Return address after signing in",
      "es": "Dirección de vuelta tras iniciar sesión",
      "gl": "Enderezo de volta tras iniciar sesión"
    },
    "description": {
      "en": "Where GitLab sends the browser back with the code; it must be the one registered in the OAuth application. Empty: this LINEA's address + /login.",
      "es": "Adonde GitLab devuelve el navegador con el código; debe ser la registrada en la aplicación OAuth. Vacío: la dirección de esta LINEA + /login.",
      "gl": "Onde GitLab devolve o navegador co código; debe ser a rexistrada na aplicación OAuth. Baleiro: o enderezo desta LINEA + /login."
    }
  },
  "defaultNamespace": {
    "type": "string",
    "default": "linea/spls",
    "public": true,
    "label": {
      "en": "Group new SPLs go to",
      "es": "Grupo donde se crean las SPL",
      "gl": "Grupo onde se crean as SPL"
    },
    "description": {
      "en": "The full path of a GitLab group. Empty: linea/spls. If the person cannot use it, the last one they used.",
      "es": "La ruta completa de un grupo de GitLab. Vacío: linea/spls. Si la persona no puede usarlo, el último que usó.",
      "gl": "A ruta completa dun grupo de GitLab. Baleiro: linea/spls. Se a persoa non pode usalo, o último que usou."
    }
  }
},
  github: {
  "url": {
    "type": "url",
    "env": "GITHUB_URL",
    "public": true,
    "default": "https://github.com",
    "label": {
      "en": "GitHub address",
      "es": "Dirección de GitHub",
      "gl": "Enderezo de GitHub"
    },
    "description": {
      "en": "github.com, or the address of a GitHub Enterprise Server.",
      "es": "github.com, o la dirección de un GitHub Enterprise Server.",
      "gl": "github.com, ou o enderezo dun GitHub Enterprise Server."
    }
  },
  "apiUrl": {
    "type": "url",
    "env": "GITHUB_API_URL",
    "label": {
      "en": "API address",
      "es": "Dirección de la API",
      "gl": "Enderezo da API"
    },
    "description": {
      "en": "Empty: api.github.com, or <address>/api/v3.",
      "es": "Vacío: api.github.com, o <dirección>/api/v3.",
      "gl": "Baleiro: api.github.com, ou <enderezo>/api/v3."
    }
  },
  "clientId": {
    "type": "string",
    "env": "GITHUB_CLIENT_ID",
    "required": true,
    "label": {
      "en": "OAuth App client ID",
      "es": "Client ID de la OAuth App",
      "gl": "Client ID da OAuth App"
    }
  },
  "clientSecret": {
    "type": "secret",
    "env": "GITHUB_CLIENT_SECRET",
    "required": true,
    "label": {
      "en": "OAuth App client secret",
      "es": "Client secret de la OAuth App",
      "gl": "Client secret da OAuth App"
    }
  },
  "webIdeUrl": {
    "type": "url",
    "env": "GITHUB_WEB_IDE_URL",
    "label": {
      "en": "Web editor address",
      "es": "Dirección del editor web",
      "gl": "Enderezo do editor web"
    }
  },
  "token": {
    "type": "secret",
    "env": "GITHUB_TOKEN",
    "label": {
      "en": "Read-only token",
      "es": "Token de solo lectura",
      "gl": "Token de só lectura"
    },
    "description": {
      "en": "Read packages from public repositories without a signed-in user.",
      "es": "Leer paquetes de repositorios públicos sin un usuario con sesión.",
      "gl": "Ler paquetes de repositorios públicos sen un usuario con sesión."
    }
  },
  "redirectUri": {
    "type": "url",
    "env": "GITHUB_REDIRECT_URI",
    "label": {
      "en": "Return address after signing in",
      "es": "Dirección de vuelta tras iniciar sesión",
      "gl": "Enderezo de volta tras iniciar sesión"
    },
    "description": {
      "en": "Where GitHub sends the browser back with the code; it must be the one registered in the OAuth application. Empty: this LINEA's address + /login.",
      "es": "Adonde GitHub devuelve el navegador con el código; debe ser la registrada en la aplicación OAuth. Vacío: la dirección de esta LINEA + /login.",
      "gl": "Onde GitHub devolve o navegador co código; debe ser a rexistrada na aplicación OAuth. Baleiro: o enderezo desta LINEA + /login."
    }
  },
  "defaultNamespace": {
    "type": "string",
    "default": "",
    "public": true,
    "label": {
      "en": "Account or organization new SPLs go to",
      "es": "Cuenta u organización donde se crean las SPL",
      "gl": "Conta ou organización onde se crean as SPL"
    },
    "description": {
      "en": "A GitHub login, e.g. my-org. Empty: the last one used.",
      "es": "Un login de GitHub, p. ej. my-org. Vacío: el último usado.",
      "gl": "Un login de GitHub, p. ex. my-org. Baleiro: o último usado."
    }
  }
},
};

/** What the interface calls things on each host (a merge request is a pull request on GitHub...). */
// (the name of a host and whether it runs pipelines are `hostDescriptor(kind)` of linea-git)
export const HOST_TERMS = {
  local: { changeRequest: 'change request', namespace: 'group', namespaceRequired: false },
  gitlab: { changeRequest: 'merge request', namespace: 'group' },
  github: { changeRequest: 'pull request', namespace: 'organization' },
};

/** The hosts, in the order they are offered. */
export const HOST_KINDS = Object.keys(HOST_SCHEMAS);
