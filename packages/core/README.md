# @lbdudc/linea-core

Motor de Líneas de Producto Software: feature models, módulos y metamodelos,
specs de producto y derivación.

Es una librería de funciones sin estado. Cada función recibe lo que necesita por
parámetros y devuelve el resultado; no hay singletons, ni configuración global,
ni base de datos. Tampoco hace peticiones de red: trabaja sobre directorios en
disco, y la integración con GitLab la pone quien la use.

## Instalación

```bash
npm install @lbdudc/linea-core
```

Requiere Node >= 20.11. Probado también con Bun 1.3.

## Uso

Todas las funciones reciben un único objeto de parámetros con nombres, también
las de un solo argumento.

### Feature models

El feature model de una LPS es un modelo del metamodelo `featuremodel` (bango), y la
selección de features de un producto lo es de `featureselection`: los comprueba
`checkSpl` y `checkProduct` (ver *Módulos y metamodelos*). Para leer o escribir un
feature model en texto UVL, por ejemplo el que componen los módulos de una LPS:

```js
import { parseUvl, printUvl, featuresOf } from '@lbdudc/linea-core'

const tree = parseUvl({ content })                     // lanza UvlParseError
const nombres = featuresOf({ tree }).map((f) => f.name)
const uvl = printUvl({ tree })
```

### Spec de producto

```js
import {
  validateProductSpec, normalizeProductSpec, incrementVersion
} from '@lbdudc/linea-core'

const { valid, errors } = validateProductSpec({ spec })
const completo = normalizeProductSpec({ spec })
incrementVersion({ version: '1.2.3', index: 1 })   // '1.3.0'
```

`errors[].messageKey` es una clave de i18n, no una frase: tradúcela en el
consumidor y ramifica con `errors[].code`, que es estable. Diez de las quince
claves son nuevas y todavía no tienen traducción; están listadas en
`CHANGELOG.md`.

### Crear una línea

```js
import { buildLineScaffold, writeLineScaffold } from '@lbdudc/linea-core'

// Devuelve los ficheros, sin tocar disco.
const files = buildLineScaffold({ name: 'MiLinea' })
// -> [{ path: 'spl.json', content: '...', encoding: 'text' },
//     { path: 'models/featuremodel.featuremodel', ... }, ...]

// O los escribe.
const { dir } = writeLineScaffold({ dir: '/tmp/mi-linea', name: 'MiLinea' })
```

Hay dos funciones porque un consumidor sube esos ficheros a un repositorio
remoto y otro los escribe en local, y ninguno necesita lo que hace el otro.

### Derivar un producto

```js
import { deriveProduct, deriveProductToZip } from '@lbdudc/linea-core'

const spec = {
  basicData: { name: 'MiTienda', version: '1.0.0' },
  features: ['Shop', 'Payment']
}

await deriveProduct({ lineDir: '/tmp/mi-linea', spec, outputDir: '/tmp/producto' })
const zip = await deriveProductToZip({ lineDir: '/tmp/mi-linea', spec })  // Buffer
```

Una selección inválida lanza `FeatureSelectionInvalidError`; un fallo de la
plataforma o del motor, `LinePlatformNotFoundError`. La derivación no borra
nada: los directorios son de quien llama.

Al escribir un `extra.js` para una línea, usa comentarios `/* */` y no `//`. El
procesador de plantillas junta el código en una sola línea, así que un
comentario de línea se come el resto de la función y el fichero sale vacío.

### Índice de productos

```js
import {
  readProductsIndex, addProductToIndex, writeProductsIndex, reconcileProductsIndex
} from '@lbdudc/linea-core'

const index = readProductsIndex({ lineDir: '/tmp/mi-linea' })   // vacío si no existe

const siguiente = addProductToIndex({
  index,
  product: { name: 'mi-producto', repositorio: 'grupo/mi-linea/mi-producto', version: '1.0.0' }
})
writeProductsIndex({ lineDir: '/tmp/mi-linea', index: siguiente })
```

Las mutaciones devuelven un índice nuevo. `version` es opcional y, si se omite,
la entrada no lleva la clave. La serialización es determinista, para que dos
escrituras del mismo índice den los mismos bytes.

`reconcileProductsIndex` compara el índice con una lista de repositorios y
reporta las diferencias en `added` y `removed`, pero no elimina entradas: qué
hacer con un producto que ya no aparece lo decide el consumidor.

### Módulos y metamodelos

Una LPS puede componerse de **módulos**. Cada módulo declara los metamodelos (gramáticas Langium, gestionadas con
[bango](https://www.npmjs.com/package/@lbdudc/bango), paquete `@lbdudc/bango`) y los módulos que necesita, y puede ofrecer modelos de solo lectura. Un producto de la LPS debe proporcionar
un modelo de **cada** metamodelo requerido por **todos** los módulos de su LPS.

```
metamodelo/  metamodel.json  grammars/<g>.langium  {constraints,specs,imports,scopes,visualizations}/<g>.js  cases/<g>.json
módulo/      .linea/{module.json,model.uvl,config/{config.json,extra.js,transformation.js}}  code/  models/
LPS/         spl.json  linea.lock.json  src/platform/{model.uvl,code/,...}   (lo propio de la LPS, opcional)
producto/    .linea/spec.json  models/<metamodelo>.<ext>
```

`linea-core` no descarga nada: recibe un `PackageSource` (`createFsPackageSource`, `createMemoryPackageSource`, o uno propio
para GitLab) y un `createEngine` que devuelve un motor de metamodelos (`new Bango()` de `@lbdudc/bango`; no es dependencia de
`linea-core`).

```ts
const resolved = await resolveSpl({ spl, source, lock })        // cierre transitivo, una versión por paquete
const report   = await checkSpl({ resolved, spl: splFiles, createEngine })
const verdict  = await checkProduct({ resolved, spl: splFiles, models, spec, createEngine })
await deriveModularProduct({ resolved, spl: splFiles, spec, models, createEngine, outputDir })
```

Los problemas de los paquetes se devuelven como `Diagnostic[]` (`package`, `file`, `message`); nunca se lanzan, salvo en
`deriveModularProduct` y `composePlatform` (`ModuleCheckError`). Los modelos que ofrece un módulo participan en la validación
del producto (se puede referenciar `UM_User`) pero no se pueden editar y no forman parte del JSON del producto. La
transformación recibe el JSON fusionado de los modelos del producto como `input.models`.

### Archivo, diff y formato

```js
import { extractArchive, diffDirectories, formatDirectory } from '@lbdudc/linea-core'

const { dir } = await extractArchive({ source: '/tmp/a.zip', destDir: '/tmp/out' })
await formatDirectory({ dir })
const changes = diffDirectories({ oldDir: '/tmp/anterior', newDir: dir })
// -> [{ action: 'update', file_path: 'src/App.java', content: '...', encoding: 'text' }]
```

`file_path` es siempre relativo y en formato POSIX. La forma de `FileChange`
coincide con la que espera la API de commits de GitLab, para que un consumidor
pueda pasarla sin adaptarla.

### Analizar un feature model

```js
import {
  createAnalysisRuntime, disposeAnalysisRuntime, analyzeFeatureModel, analyzeMetric
} from '@lbdudc/linea-core'

const runtime = await createAnalysisRuntime()   // ~2,3 s: arranca Pyodide
try {
  const info = await analyzeFeatureModel({ uvl, runtime })
  const dead = await analyzeMetric({ uvl, metric: 'deadFeatures', runtime })
} finally {
  disposeAnalysisRuntime({ runtime })
}
```

El `runtime` es de quien llama. Se puede omitir y cada llamada crea el suyo, que
es correcto pero lento.

Dos avisos para usarlo en un servidor:

- `disposeAnalysisRuntime` no libera memoria. Pyodide no ofrece teardown, así
  que los ~180 MB de heap se quedan hasta que muera el proceso; `dispose` solo
  inutiliza el handle. Crear un runtime por petición filtra un intérprete cada
  vez: mantén unos pocos y reutilízalos.
- El arranque falla en el acto si faltan los paquetes de Python que van dentro
  del propio módulo. Es a propósito: la alternativa era descargarlos de una CDN
  en silencio.

Un análisis que falla en un cálculo concreto devuelve `null` en ese campo y lo
anota en `_skipped`, en vez de abortar la respuesta entera.

## Estructura de un directorio de línea

```
<lineDir>/
  products.json                     índice de productos
  src/platform/
    model.uvl                       feature model que lee la derivación
    config.json                     configuración del motor de derivación
    extra.js                        helpers de plantilla
    transformation.js               transformación de la spec
    code/                           código anotado
```

## Desarrollo

```bash
npm install
npm run typecheck
npm run lint
npm run test
npm run build
```

Los ficheros que no son TypeScript bajo `src/` son assets: el build los copia a
`dist/` conservando su ruta, y se localizan en tiempo de ejecución relativos al
módulo.

## Limitaciones conocidas

- La licencia está sin decidir; `package.json` declara `UNLICENSED` como
  marcador.
- `spl-js-engine` va fijado a un commit de una rama sin publicar, porque la
  versión publicada en npm no admite UVL. Se migrará cuando exista una versión
  con soporte.
- El parser de UVL escribe en `stderr` en cada parseo por un fallo suyo de
  detección de rutas. El módulo filtra ese mensaje concreto.
