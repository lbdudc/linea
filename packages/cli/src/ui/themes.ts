/**
 * The colours of the window. `linea` is the default and takes its palette from the web interface (its dark theme: the surfaces,
 * text ramp, accent and status colours of `linea/client/src/theme/tokens.css`), so the terminal and the browser look like one product.
 * The others are for other terminals and tastes. A theme is chosen with `config theme <name>` or the `LINEA_THEME` variable.
 */
export interface ThemeColors {
  /** the colour of LINEA in the terminal: the welcome panel, the prompt, the spinner, what is suggested */
  brand: string;
  brandBright: string;
  muted: string;
  faint: string;
  success: string;
  error: string;
  warn: string;
  info: string;
  fg: string;
  border: string;
  /** the line you typed, as a quote in the history */
  quoteBg: string;
}

export interface ThemeInfo {
  name: string;
  summary: string;
  colors: ThemeColors;
}

export const DEFAULT_THEME = 'linea';

export const THEMES: readonly ThemeInfo[] = [
  {
    name: 'linea',
    summary: 'the web interface, dark: navy surfaces and the blue accent (default)',
    colors: {
      brand: '#60a5fa', // --p-primary-color
      brandBright: '#93c5fd', // --p-primary-hover-color
      muted: '#94a3b8', // --p-text-muted-color
      faint: '#7d90a8', // --p-text-dim-color
      success: '#4ade80', // --status-ok-strong
      error: '#f87171', // --status-bad
      warn: '#f59e0b', // --status-warn
      info: '#7dd3fc',
      fg: '#f1f5f9', // --p-text-color
      border: '#334155', // --p-content-border-color
      quoteBg: '#1e293b', // --p-content-hover-background
    },
  },
  {
    name: 'linea-light',
    summary: 'the web interface, light: for terminals with a white background',
    colors: {
      brand: '#222261', // --p-primary-color (light)
      brandBright: '#2563eb', // --p-primary-hover-color
      muted: '#475569', // --p-text-muted-color
      faint: '#5d6b7f', // --p-text-dim-color
      success: '#15803d', // --status-ok
      error: '#b91c1c', // --status-bad
      warn: '#b45309', // --status-warn
      info: '#0369a1',
      fg: '#1e293b', // --p-text-color
      border: '#cbd5e1',
      quoteBg: '#e2e8f0',
    },
  },
  {
    name: 'ember',
    summary: 'warm orange on a neutral dark: the colours the CLI had before it followed the web',
    colors: {
      brand: '#d97757',
      brandBright: '#f0a58a',
      muted: '#9a9a9a',
      faint: '#6b6b6b',
      success: '#5fcf80',
      error: '#f0605d',
      warn: '#e5c07b',
      info: '#6cc6d9',
      fg: '#e6e6e6',
      border: '#555555',
      quoteBg: '#2b2b2b',
    },
  },
  {
    name: 'mono',
    summary: 'no hue: greys and bold white, and only red for errors; for any terminal, or print',
    colors: {
      brand: '#ffffff',
      brandBright: '#ffffff',
      muted: '#a8a8a8',
      faint: '#767676',
      success: '#d0d0d0',
      error: '#ff6b6b',
      warn: '#d0d0d0',
      info: '#d0d0d0',
      fg: '#e8e8e8',
      border: '#4a4a4a',
      quoteBg: '#2a2a2a',
    },
  },
];

export const findTheme = (name: string | undefined): ThemeInfo | undefined =>
  name ? THEMES.find((t) => t.name === name.trim().toLowerCase()) : undefined;

/** Which theme is in use: the environment wins over what `config theme` stored; a name nobody knows falls back to the default. */
export function resolveTheme(env: string | undefined, stored: string | undefined): ThemeInfo {
  return findTheme(env) ?? findTheme(stored) ?? findTheme(DEFAULT_THEME)!;
}
