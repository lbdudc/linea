import { describe, it, expect } from 'bun:test';
import { getCommand, allCommands, visibleCommands, resolveCommand, NOUNS } from '../src/commands/registry.js';

describe('command registry', () => {
  it('resolves the commands people use, by name', () => {
    for (const name of ['help', 'login', 'get', 'push', 'status', 'open', 'check', 'generate', 'cd', 'spl new', 'spl list', 'product new', 'fm show', 'module publish']) {
      expect(getCommand(name)?.name).toBe(name);
    }
  });

  it('resolves aliases', () => {
    expect(getCommand('?')?.name).toBe('keys');
    expect(getCommand('h')?.name).toBe('help');
    expect(getCommand('q')?.name).toBe('exit');
  });

  it('has unique command names, and a summary for each', () => {
    const names = allCommands().map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of allCommands()) expect(c.summary.length).toBeGreaterThan(0);
  });

  it('has no modes and no old names: a command acts on the folder you are in, and on LINEA when it says so', () => {
    for (const c of allCommands()) expect(c).not.toHaveProperty('modes');
    for (const old of ['lines', 'use', 'newline', 'create', 'model', 'products', 'zip', 'health', 'ask', 'agents', 'run', 'clone', 'pull', 'link', 'web', 'repo']) {
      expect(getCommand(old)).toBeUndefined();
    }
  });

  it('keeps what was folded into another command working, but out of the lists', () => {
    const folded = ['spl modules', 'product models', 'product conflicts', 'product update', 'fm edit', 'module clone', 'metamodel clone'];
    const listed = visibleCommands().map((c) => c.name);
    for (const name of folded) {
      expect(getCommand(name)?.hidden).toBe(true);
      expect(listed).not.toContain(name);
    }
    for (const name of ['spl show', 'product show', 'open', 'get']) expect(listed).toContain(name);
  });

  it('asks to be signed in only for what only the server can do', () => {
    const needing = allCommands().filter((c) => c.requiresAuth).map((c) => c.name).sort();
    expect(needing).toEqual(['namespaces', 'product changes', 'product conflicts', 'product deployment', 'product logs', 'product pipeline', 'product rollback', 'reconcile']);
  });

  it('takes the longest name, and says what a noun can do when the verb is wrong', () => {
    expect(resolveCommand(['spl', 'list'])).toMatchObject({ cmd: { name: 'spl list' }, args: [] });
    expect(resolveCommand(['product', 'models', 'shop'])).toMatchObject({ cmd: { name: 'product models' }, args: ['shop'] });
    const wrong = resolveCommand(['spl', 'bogus']);
    expect((wrong as { error: string }).error).toMatch(/Unknown: spl bogus\. Try: /);
    expect((wrong as { error: string }).error).toContain('spl list');
    expect((wrong as { error: string }).error).toContain('spl add');
    expect((resolveCommand(['product']) as { error: string }).error).toMatch(/product what\?/);
    expect(resolveCommand(['nonsense'])).toHaveProperty('error');
    expect(NOUNS).toEqual(expect.arrayContaining(['spl', 'product', 'fm', 'module', 'metamodel']));
  });
});
