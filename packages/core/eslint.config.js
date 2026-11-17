import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * ADR-002: linea-core never talks to the network.
 *
 * `no-restricted-imports.paths` only matches EXACT specifiers, so `https` and
 * `node:https` are two different entries and `http2` would slip through
 * entirely. The regex pattern below is what actually closes the door; the named
 * paths cover third-party clients. `test/adr-002.test.ts` lints a probe file and
 * asserts these rules fire, so the guard cannot silently rot.
 */
const NO_NETWORK_IMPORTS = {
  patterns: [
    {
      // http, https, http2, net, tls, dgram, dns — bare or `node:`-prefixed,
      // including submodules such as `node:dns/promises`.
      regex: '^(node:)?(https?|http2|net|tls|dgram|dns)(/.*)?$',
      message: 'ADR-002: linea-core is offline. No network modules.'
    }
  ],
  paths: [
    { name: 'axios', message: 'ADR-002: linea-core is offline.' },
    { name: 'node-fetch', message: 'ADR-002: linea-core is offline.' },
    { name: 'undici', message: 'ADR-002: linea-core is offline.' },
    { name: 'got', message: 'ADR-002: linea-core is offline.' },
    { name: 'superagent', message: 'ADR-002: linea-core is offline.' },
    { name: 'ws', message: 'ADR-002: linea-core is offline.' }
  ]
}

const NO_NETWORK_GLOBALS = [
  { name: 'fetch', message: 'ADR-002: linea-core is offline. No network calls.' },
  { name: 'XMLHttpRequest', message: 'ADR-002: linea-core is offline. No network calls.' },
  { name: 'WebSocket', message: 'ADR-002: linea-core is offline. No network calls.' },
  { name: 'EventSource', message: 'ADR-002: linea-core is offline. No network calls.' }
]

// `no-restricted-globals` does not see member expressions like `globalThis.fetch`.
const NO_NETWORK_PROPERTIES = ['globalThis', 'global', 'window'].flatMap((object) =>
  ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource'].map((property) => ({
    object,
    property,
    message: 'ADR-002: linea-core is offline. No network calls.'
  }))
)

/**
 * `no-restricted-properties` matches `<Identifier>.<name>` only, so a cast such
 * as `(globalThis as unknown as { fetch: ... }).fetch(...)` slips past it — the
 * probe caught exactly that. These selectors match the CALL regardless of how
 * the callee is spelled or wrapped.
 */
const NO_NETWORK_SYNTAX = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map((name) => ({
  selector: `CallExpression[callee.property.name='${name}'], NewExpression[callee.property.name='${name}']`,
  message: `ADR-002: linea-core is offline. "${name}" is not available, however it is reached.`
}))

/**
 * Dynamic `import()` is an `ImportExpression`, not an `ImportDeclaration`, and
 * `no-restricted-imports` only inspects the latter — so `await import('axios')`
 * sailed straight through the rules above.
 *
 * This is the vector that matters most going forward: lazy-loading pyodide in
 * `src/analysis/` is exactly the place where someone writes `await import(...)`.
 *
 * Note the `[/]` character class for the slash: esquery's parser throws a
 * SyntaxError on an escaped `\/` inside these attribute regexes.
 */
const NO_NETWORK_DYNAMIC_IMPORTS = [
  {
    selector: "ImportExpression[source.value=/^(node:)?(https?|http2|net|tls|dgram|dns)([/].*)?$/]",
    message: 'ADR-002: linea-core is offline. No network modules.'
  },
  {
    selector: "ImportExpression[source.value=/^(axios|node-fetch|undici|got|superagent|ws)$/]",
    message: 'ADR-002: linea-core is offline. No network clients.'
  }
]

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      // Deliberately rule-violating probe, linted on purpose by test/adr-002.test.ts.
      // Named exactly, not `test/fixtures/**`: a future helper dropped in that
      // directory must not go unlinted just because it lives next to the probe.
      'test/fixtures/adr-002-probe.ts',
      // Byte-for-byte copies of linea/server/src/model/services/templates/**.
      // They are ASSETS shipped to generated lines, not linea-core source: they
      // must stay identical to the monolith, so linting (and any autofix) would
      // be actively harmful.
      'src/line/templates/**',
      // Annotated LPS fixture: its `.js` files contain `/*% ... %*/` template
      // annotations and are not valid JavaScript until the engine derives them.
      'test/fixtures/lps-min/**',
      // Packages of a modular SPL: grammars, their scripts and annotated code, none of it linea-core source.
      'test/fixtures/modular/**'
    ]
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        // The typecheck project is the wide one: it covers src, test and
        // scripts. tsconfig.json only includes src (rootDir), so using it here
        // would leave every test file outside the program.
        project: ['./tsconfig.typecheck.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      'no-restricted-globals': ['error', ...NO_NETWORK_GLOBALS],
      'no-restricted-properties': ['error', ...NO_NETWORK_PROPERTIES],
      'no-restricted-syntax': ['error', ...NO_NETWORK_SYNTAX, ...NO_NETWORK_DYNAMIC_IMPORTS],
      'no-restricted-imports': ['error', NO_NETWORK_IMPORTS],

      // ADR-014: stateless library. `let`/`var` at module scope is how caches
      // and singletons creep in (see agents/tools/splContext.js:fmCache).
      'prefer-const': 'error',
      'no-var': 'error',

      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },

  {
    // The library itself spawns nothing (ADR-014) and owns no processes.
    // Tests may shell out: package-hygiene.test.ts runs `npm pack --dry-run`.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...NO_NETWORK_IMPORTS,
          paths: [
            ...NO_NETWORK_IMPORTS.paths,
            { name: 'child_process', message: 'ADR-014: linea-core spawns no processes.' },
            { name: 'node:child_process', message: 'ADR-014: linea-core spawns no processes.' },
            { name: 'worker_threads', message: 'ADR-014: linea-core spawns no processes.' },
            { name: 'node:worker_threads', message: 'ADR-014: linea-core spawns no processes.' }
          ]
        }
      ]
    }
  },

  {
    // The ADR-002 network interceptor has to REACH FOR the very modules the
    // ADR-002 rules forbid — that is the whole point of the test: it patches
    // http/https/net/dns so any outbound attempt by the analysis stack fails
    // loudly. Scoped to this one file, and only for the network rules.
    files: ['test/analysis/offline.test.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off'
    }
  },

  // Plain-JS tooling files (build scripts, this config) are not part of the TS
  // program: they are typed through JSDoc, not through the checker.
  {
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: { ...globals.node }
    }
  }
)
