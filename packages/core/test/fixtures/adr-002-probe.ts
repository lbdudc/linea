/**
 * ADR-002 probe. Every line below MUST be rejected by eslint.config.js.
 *
 * This file is in the `ignores` list of the flat config so `npm run lint` skips
 * it; `test/adr-002.test.ts` lints it explicitly with `ignore: false` and asserts
 * the expected rules fire. It exists because the first version of the config
 * used only `no-restricted-imports.paths`, which silently let `import https from
 * 'https'`, `node:http2` and `globalThis.fetch(...)` straight through.
 *
 * It must stay type-correct: `npm run typecheck` covers `test/**`.
 */
import https from 'https'
import http from 'node:http'
import http2 from 'node:http2'
import net from 'net'
import dns from 'node:dns/promises'

export const probeBareHttps = (): unknown => https
export const probePrefixedHttp = (): unknown => http
export const probeHttp2 = (): unknown => http2
export const probeNet = (): unknown => net
export const probeDns = (): unknown => dns

// Plain member access: caught by no-restricted-properties.
export const probeGlobalFetch = async (): Promise<unknown> => await globalThis.fetch('http://x')

// Bare global: caught by no-restricted-globals.
export const probeBareFetch = async (): Promise<unknown> => await fetch('http://x')

// Cast to hide `globalThis` from no-restricted-properties. The probe originally
// used only this form and the rule did NOT fire, which is why no-restricted-syntax
// exists: it matches the call however the callee is spelled.
export const probeCastFetch = async (): Promise<unknown> =>
  await (globalThis as unknown as { fetch: (url: string) => Promise<unknown> }).fetch('http://x')

// Dynamic import() is an ImportExpression, which `no-restricted-imports` never
// inspects — it only walks ImportDeclaration. These three passed with zero
// messages until the ImportExpression selectors were added. This is the shape
// lazy-loading pyodide would take in src/analysis/.
export const probeDynamicHttps = async (): Promise<unknown> => await import('node:https')
export const probeDynamicDns = async (): Promise<unknown> => await import('node:dns/promises')

// axios is not (and must never be) a dependency — test/package-hygiene.test.ts
// forbids it — so TypeScript cannot resolve it. The lint rule under test is
// syntactic and fires regardless.
export const probeDynamicAxios = async (): Promise<unknown> =>
  // @ts-ignore -- axios is deliberately absent from package.json (ADR-002); with workspaces it may resolve from another package, so not ts-expect-error.
  await import('axios')

// Must NOT be flagged: a non-network dynamic import is perfectly legitimate.
export const probeDynamicPathIsAllowed = async (): Promise<unknown> => await import('node:path')
