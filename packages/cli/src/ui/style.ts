import { theme } from './theme.js';

/**
 * Commands print plain text with a few conventions (`✓ done`, `✗ failed`, `! careful`, `· nothing to do`, `Next: …`). The window colours
 * them, so a result can be read at a glance and `✗` is not lost in a paragraph. The text itself is never changed.
 */

export type Tone = 'plain' | 'ok' | 'err' | 'warn' | 'info' | 'dim' | 'faint' | 'brand';

export interface Part {
  text: string;
  tone: Tone;
}

export const TONE_COLOR: Record<Tone, string> = {
  plain: theme.fg,
  ok: theme.success,
  err: theme.error,
  warn: theme.warn,
  info: theme.info,
  dim: theme.muted,
  faint: theme.faint,
  brand: theme.brand,
};

const GLYPHS: Record<string, { glyph: Tone; rest: Tone }> = {
  '✓': { glyph: 'ok', rest: 'plain' },
  '✗': { glyph: 'err', rest: 'plain' },
  '!': { glyph: 'warn', rest: 'plain' },
  '⚠': { glyph: 'warn', rest: 'plain' },
  '·': { glyph: 'dim', rest: 'dim' },
  '…': { glyph: 'faint', rest: 'dim' },
};

/** Where an SPL is, in `spl list`: what it is called and where it is share the colour of the place. */
const WHERE: Record<string, Tone> = { 'here + LINEA': 'ok', 'here only': 'warn', 'LINEA only': 'info' };

export function parseLine(line: string): Part[] {
  const spl = /^(\s+)(\S+)(\s+)(here \+ LINEA|here only|LINEA only)(.*)$/.exec(line);
  if (spl) {
    const [, indent, name, gap, place, rest] = spl as unknown as [string, string, string, string, string, string];
    return [
      { text: indent, tone: 'plain' },
      { text: name, tone: WHERE[place]! },
      { text: gap, tone: 'plain' },
      { text: place, tone: WHERE[place]! },
      { text: rest, tone: 'dim' },
    ];
  }
  const glyph = /^(\s*)(✓|✗|!|⚠|·|…)(\s+)(.*)$/.exec(line);
  if (glyph) {
    const [, indent, mark, gap, rest] = glyph as unknown as [string, string, string, string, string];
    const tones = GLYPHS[mark]!;
    return [
      ...(indent ? [{ text: indent, tone: 'plain' as const }] : []),
      { text: mark, tone: tones.glyph },
      { text: `${gap}${rest}`, tone: tones.rest },
    ];
  }
  const next = /^(\s*)(Next:)(.*)$/.exec(line);
  if (next) return [{ text: `${next[1]}${next[2]}`, tone: 'brand' }, { text: next[3] ?? '', tone: 'dim' }];
  if (/^\s*\(.*\)\s*$/.test(line)) return [{ text: line, tone: 'dim' }];
  return [{ text: line, tone: 'plain' }];
}

/** `text` cut to `width` columns, ending in `…` when it was cut. */
export const clip = (text: string, width: number): string => (width <= 1 ? '' : text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`);

/** The first part of a description: up to the first `;`, ` (` or ` — `, when what is left is still a sentence. */
export function brief(summary: string): string {
  const cut = summary.split(/;| \(| — |\. /)[0]!.trim();
  return cut.length >= 18 ? cut : summary;
}

const rgb = (hex: string): string => `${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}`;

/** The same colours for a terminal that is not the window (`linea spl list`): ANSI, one line at a time. Unchanged when `on` is false. */
export function colorize(text: string, on: boolean): string {
  if (!on) return text;
  const ESC = String.fromCharCode(27);
  return text
    .split('\n')
    .map((line) => parseLine(line).map((p) => (p.tone === 'plain' ? p.text : `${ESC}[38;2;${rgb(TONE_COLOR[p.tone])}m${p.text}${ESC}[0m`)).join(''))
    .join('\n');
}
