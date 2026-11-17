import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

interface PackageJson {
  name: string
  license: string
  type: string
  main: string
  types: string
  files: string[]
  engines: Record<string, string>
  exports: Record<string, Record<string, string>>
  scripts: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const pkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
) as PackageJson

const FORBIDDEN_RUNTIME_DEPENDENCIES = [
  'axios', 'node-fetch', 'got', 'superagent', 'undici', 'request', 'ky',
  'ws', 'socket.io', 'socket.io-client', 'eventsource',
  'gitlab-commando', '@lbdudc/gitlab-commando', '@gitbeaker/node', '@gitbeaker/rest', 'node-gitlab',
  'mongoose', 'mongodb', 'sqlite3', 'better-sqlite3', 'pg', 'mysql2', 'redis', 'ioredis',
  'express', 'fastify', 'koa', 'body-parser', 'cors', 'morgan',
  'jsonwebtoken', 'passport', 'bcrypt',
  'aws-sdk', '@aws-sdk/client-s3', '@anthropic-ai/sdk', 'openai',
  '@opentelemetry/api', 'posthog-node',
  'typedi', 'inversify', 'tsyringe'
]

describe('package hygiene', () => {
  it('declares no runtime dependency that would break ADR-002/003/013/014', () => {
    const declared = Object.keys(pkg.dependencies ?? {})
    const offenders = declared.filter((name) => FORBIDDEN_RUNTIME_DEPENDENCIES.includes(name))
    expect(offenders, `forbidden runtime dependencies: ${offenders.join(', ')}`).toEqual([])
  })

  it('keeps the runtime dependency set minimal and explicit', () => {
    expect(Object.keys(pkg.dependencies ?? {}).sort())
      .toEqual(['@lbdudc/flamapy.js', 'extract-zip', 'prettier', 'pyodide', 'semver', 'spl-js-engine'])
  })

  it('pins pyodide exactly, because the vendored wheels are tied to its version', () => {
    expect(pkg.dependencies?.pyodide).toBe('0.26.2')
  })

  it('pins spl-js-engine to an exact commit over https', () => {
    const spec = pkg.dependencies?.['spl-js-engine'] ?? ''
    expect(spec).toContain('#3b64b69b74495e3993fb08bee7daa9cf166d49fb')
    expect(spec.startsWith('git+https://'), `must use git+https://, got "${spec}"`).toBe(true)
    expect(spec).not.toContain('git+ssh')
  })

  it('is an ESM package that resolves to dist/', () => {
    expect(pkg.type).toBe('module')
    expect(pkg.main).toBe('./dist/index.js')
    expect(pkg.types).toBe('./dist/index.d.ts')
    expect(pkg.exports['.']).toEqual({
      types: './dist/index.d.ts',
      import: './dist/index.js'
    })
    expect(Object.keys(pkg.exports)).toEqual(['.', './workspace'])
  })

  it('works as a git dependency without extra steps: it builds on install, or it ships its compiled dist', () => {
    // a branch used as a git dependency where its devDependencies cannot be installed (a CI runner) drops `prepare` and commits dist
    const buildsOnInstall = pkg.scripts.prepare === 'npm run build'
    const shipsDist = pkg.scripts.prepare === undefined && fs.existsSync(path.join(ROOT, 'dist', 'index.js'))
    expect(buildsOnInstall || shipsDist).toBe(true)
    expect(pkg.scripts.build).toContain('tsc')
  })

  it('requires Node >=20.11 (import.meta.dirname, used by the lint config)', () => {
    expect(pkg.engines.node).toBe('>=20.11')
  })

  it('is Apache-2.0', () => {
    expect(pkg.license).toBe('Apache-2.0')
  })

  it('ships neither tests nor fixtures nor TypeScript sources', () => {
    const output = execSync(
      'npm pack --dry-run --json --ignore-scripts',
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
    let parsed: unknown
    try {
      let from = output.search(/[[{]/)
      if (from < 0) throw new Error('no JSON payload in output')
      for (;;) {
        try {
          parsed = JSON.parse(output.slice(from))
          break
        } catch (attempt) {
          const next = output.slice(from + 1).search(/[[{]/)
          if (next < 0) throw attempt
          from = from + 1 + next
        }
      }
    } catch (cause) {
      const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim()
      throw new Error(
        'could not read "npm pack --dry-run --json" output (npm ' + npmVersion +
          '): ' + (cause as Error).message +
          '\nRaw output was:\n' + output.slice(0, 2000)
      )
    }
    const reports = (
      Array.isArray(parsed) ? parsed : Object.values(parsed as Record<string, unknown>)
    ) as { files?: { path: string }[] }[]
    const [report] = reports
    const packed = (report?.files ?? []).map((file) => file.path.replace(/\\/g, '/'))

    expect(packed.length).toBeGreaterThan(0)
    expect(packed.filter((p) => p.startsWith('test/'))).toEqual([])
    expect(packed.filter((p) => p.includes('fixtures'))).toEqual([])
    expect(packed.filter((p) => p.startsWith('src/'))).toEqual([])
    expect(packed.filter((p) => p.endsWith('.test.ts'))).toEqual([])
    expect(packed.filter((p) => p.endsWith('.ts') && !p.endsWith('.d.ts'))).toEqual([])
    expect(packed).toContain('package.json')
    expect(packed).toContain('README.md')
  })
})
