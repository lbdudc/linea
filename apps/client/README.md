# apps/client

Front de LINEA: Vue 3 + PrimeVue 4 sobre Vite. El build sale en `dist/`.

```bash
npm install
npm run dev      # desarrollo
npm run build    # producción
```

## Comprobaciones

```bash
npm run lint
npm run check:tokens    # tokens sincronizados + colores literales por carpeta
npm run test:scripts    # tests de los guardianes
npx vitest run
npm run build
```

El **build es obligatorio**: el lint no parsea SCSS, así que una llave mal
cerrada en un bloque de estilos lo pasa y revienta el build.

Si el build falla con `Rollup failed to resolve
monaco-editor/...htmlFileSystemProvider.js` no es el código: npm ha bloqueado los
`postinstall`. Ejecuta `npx monaco-treemending` y
`node scripts/copy-monaco-workers.js`.

## Configuración

| Fichero | Qué define |
|---|---|
| `vite.config.mjs` | Alias, shim de lodash, polyfills de Node, plugins de Monaco, proxy de desarrollo. |
| `src/main.js` | El arranque, en orden. |
| `index.html` | Plantilla, `<div id="app">` y el script que fija la clase de tema antes del primer pintado. |
| `vitest.config.mjs` | Tests, con su propia instancia de Vite. |

Los alias de `vitest.config.mjs` tienen que coincidir con los de
`vite.config.mjs` y con `jsconfig.json`: si tocas una lista, toca las tres.

## Stack

| Librería | Notas |
|---|---|
| Vite 2.9 | Subir de major toca los plugins de Monaco. |
| PrimeVue 4 (styled) | Se instala en `src/boot/primevue.js` con el preset `src/theme/preset-linea.js`. |
| Monaco | Editor UVL/XML. |
| bango | Vistas de los modelos de un producto y editor de metamodelos. Sus bundles (`bango/*.js`) se copian a `public/` con `scripts/copy-bango-worker.js`; los diagramas del modelo de datos y de los sensores los trae cada metamodelo (`<nombre>.visualizations.js`), no este cliente. |
| Chart.js / vue-chartjs | Gráficas, con el color del composable `useChartTheme`. |

`src/theme/tokens.css` y `src/theme/preset-linea.js` son copia **byte a byte** de
`docs/guia-front/`. Se cambian allí y se vuelven a copiar; ver `CLAUDE.md`.

## Tema

La clase `.dark-theme` / `.light-theme` en `<html>` es la única fuente de verdad.
La pone el script de `index.html` antes del primer pintado y la mantiene
`src/composables/useTheme.js`. PrimeVue lee esa misma clase por el
`darkModeSelector` del preset.

## Avisos

`src/composables/useNotify.js` habla directamente con el `ToastEventBus` de
PrimeVue, así que sirve también desde mixins y módulos JS sueltos, donde
`useToast()` no funciona. Necesita un `<Toast />` montado: `App.vue` monta tres
—la de por defecto abajo a la derecha, `group="top"` y `group="accion"` para los
avisos con botón—.

## Añadir un componente de PrimeVue

`import Button from 'primevue/button'`. Dos cuidados:

- `Button`, `Dialog`, `Menu`, `Select` y `Textarea` chocan con nombres
  reservados de HTML y se registran con prefijo (`PrimeButton`, `PrimeDialog`…)
  o el lint `vue/no-reserved-component-names` los rechaza.
- `Dialog` y `Menu popup` se teleportan al `body` y Vue **no** propaga el
  `data-v-…` a su raíz: cualquier regla `scoped` que apunte a `.p-dialog` o
  `.p-menu` no casa nunca. Va en un bloque `<style>` sin `scoped`. Guía §8.

## Docker

El `Dockerfile` hace `npm install` + `npm run build`; `npm start` sirve `dist/`.
`sass` está declarado como dependencia explícita, no transitiva.

## Diseño

- `docs/guia-front/GUIA-FRONT-PRIMEVUE.md` — guía maestra.
- `docs/guia-front/DISENO-LINEA.md` — el diseño aprobado de esta interfaz.
