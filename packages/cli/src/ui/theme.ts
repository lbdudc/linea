import { loadState } from '../core/credentials.js';
import { resolveTheme, type ThemeColors } from './themes.js';

const chosen = resolveTheme(process.env['LINEA_THEME'], loadState().theme);

/** The colours in use, resolved once when the window starts (see themes.ts). */
export const theme: ThemeColors = chosen.colors;
export const themeName: string = chosen.name;
