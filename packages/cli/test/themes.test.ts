import { describe, expect, it } from 'bun:test';
import { getCommand } from '../src/commands/registry.js';
import { DEFAULT_THEME, findTheme, resolveTheme, THEMES } from '../src/ui/themes.js';
import { makeCtx, makeSession } from './helpers.js';

describe('themes', () => {
  it('every theme gives every colour as a hex value', () => {
    const keys = ['brand', 'brandBright', 'muted', 'faint', 'success', 'error', 'warn', 'info', 'fg', 'border', 'quoteBg'];
    for (const t of THEMES) {
      for (const k of keys) expect((t.colors as unknown as Record<string, string>)[k]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('the default is the web interface: its accent and its text', () => {
    const t = findTheme(DEFAULT_THEME)!;
    expect(t.name).toBe('linea');
    expect(t.colors.brand).toBe('#60a5fa');
    expect(t.colors.fg).toBe('#f1f5f9');
  });

  it('the environment wins over what was stored, and a name nobody knows falls back to the default', () => {
    expect(resolveTheme('ember', 'mono').name).toBe('ember');
    expect(resolveTheme(undefined, 'mono').name).toBe('mono');
    expect(resolveTheme('nope', 'also-nope').name).toBe(DEFAULT_THEME);
    expect(resolveTheme(' EMBER ', undefined).name).toBe('ember');
  });

  it('`config theme` lists them, sets one, refuses an unknown one and goes back to the default', async () => {
    const config = getCommand('config')!;
    const session = makeSession('/unused');
    const list = String(await config.run(makeCtx(session, ['theme'])));
    for (const t of THEMES) expect(list).toContain(t.name);

    const set = String(await config.run(makeCtx(session, ['theme', 'ember'])));
    expect(set).toContain('Theme set to ember');
    expect(session.theme).toBe('ember');

    await expect(Promise.resolve().then(() => config.run(makeCtx(session, ['theme', 'neon'])))).rejects.toThrow('No theme called "neon"');

    const unset = String(await config.run(makeCtx(session, ['theme', '--unset'])));
    expect(unset).toContain(DEFAULT_THEME);
    expect(session.theme).toBeUndefined();
  });
});
