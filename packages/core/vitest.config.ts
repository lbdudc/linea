import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // adr-002 runs ESLint with type information in-process: seconds alone, tens of seconds next to the rest of the suite
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      // Ambient declarations for untyped dependencies: no runtime code.
      exclude: ['src/types/**'],
      // Enforced, not merely reported: `npm run test:coverage` fails below these.
      // Set just under the current numbers so a real regression trips them
      // without turning every refactor into a threshold edit.
      //
      // Statements and lines sit at 98 rather than 99 because of
      // `src/analysis/runtime.ts`; every other directory is at 100.
      //
      // What stays uncovered there is NARROWER than it looks: only the canary
      // paths — a Pyodide that boots but whose canary throws, and one whose
      // canary returns empty. Those need a deliberately broken interpreter,
      // which can only be faked by stubbing the very thing under test, so such
      // a test would prove nothing about the real bootstrap.
      //
      // Everything else in that file IS reachable with realistic failures and IS
      // tested: missing wheels and CORRUPT wheels (a truncated download or a bad
      // npm cache) in test/analysis/wheels-missing.test.ts, and the no-network
      // proof in test/analysis/offline.test.ts. If you find another reachable
      // failure in there, write the test — do not assume the gap is defensive.
      //
      // Do NOT recover the percentage by deleting the error paths: they are what
      // stops a silently broken bootstrap from reporting empty metrics
      // (ADR-021). Vitest 2.x ignores per-glob thresholds for the global check,
      // which is why this is one number instead of a per-directory floor.
      thresholds: {
        statements: 98,
        branches: 95,
        functions: 95,
        lines: 98
      }
    }
  }
})
