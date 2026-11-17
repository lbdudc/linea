import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { makeSession, newPlainLine, run, setLineModel, useNoNetwork, useTmpDirs } from './helpers.js';

// Isolated in its own file on purpose (like linea-core's own analysis tests):
// createAnalysisRuntime() boots a private Pyodide/WASM interpreter per test
// file, and linea-core's README asks not to pile more of those into a file
// that already has one.

const tmpDir = useTmpDirs('linea-cli-analyze');
const network = useNoNetwork();

async function shopSession() {
  const session = makeSession(tmpDir());
  const lineDir = await newPlainLine(session, 'Shop');
  await setLineModel(lineDir, 'features\n\tShop\n\t\tmandatory\n\t\t\tCore\n\t\toptional\n\t\t\tGreeting\n');
  return session;
}

describe('fm analyze', () => {
  it('runs a real offline Flamapy analysis with no network access', async () => {
    const session = await shopSession();
    const out = await run(session, 'fm analyze');
    expect(out).toContain('Feature model analysis');
    expect(out).toContain('Satisfiable:   true');
    expect(network.calls()).toBe(0);
  }, 20000);

  it('--bdd runs the slow BDD/enumeration analysis offline', async () => {
    const session = await shopSession();
    const out = await run(session, 'fm analyze', '--bdd');
    expect(out).toContain('BDD analysis');
    expect(out).toContain('Variability:');
    expect(network.calls()).toBe(0);
  }, 20000);
});

describe('fm metric', () => {
  it('computes a single named metric offline', async () => {
    const session = await shopSession();
    const out = await run(session, 'fm metric', 'satisfiable');
    expect(out).toContain('satisfiable: true');
    expect(network.calls()).toBe(0);
  }, 20000);
});

describe('giving an analysis up', () => {
  it('rejects at once when the signal has already said stop, and when it says it while the worker starts', async () => {
    const { analyzeOffThread } = await import('../src/core/analysis.js');
    const stopped = new AbortController();
    stopped.abort();
    await expect(analyzeOffThread({ kind: 'analyze', dir: 'nowhere', mode: 'SAT' }, stopped.signal)).rejects.toThrow(/cancelled/);

    const later = new AbortController();
    const running = analyzeOffThread({ kind: 'analyze', dir: 'nowhere', mode: 'SAT' }, later.signal);
    later.abort();
    await expect(running).rejects.toThrow(/cancelled/);
  });
});
