import { configureClient } from '../core/client.js';
import { findEditor } from '../core/editor.js';
import { defaultDataDir, ensureDir } from '../core/workdir.js';
import { DEFAULT_THEME, findTheme, resolveTheme, THEMES } from '../ui/themes.js';
import type { Command } from './types.js';

const KEYS = ['workspace', 'editor', 'server', 'theme'] as const;
type Key = (typeof KEYS)[number];

const config: Command = {
  name: 'config',
  aliases: ['cfg'],
  summary: 'Show the settings, or set one: workspace, editor, server, theme',
  usage: 'config [workspace|editor|server|theme] [value]   (config <folder> still sets the workspace)',
  arg: 'file',
  run: ({ args, session, updateSession }) => {
    const [first, value] = args.filter((a) => !a.startsWith('--'));
    const unset = args.includes('--unset');

    if (!first) {
      let editor = 'none found';
      try {
        const found = findEditor({ preferred: session.editor });
        if (found) editor = found.name;
      } catch {
        editor = `${session.editor} (not on PATH)`;
      }
      return [
        'Settings:',
        `  workspace  ${session.workdir ?? defaultDataDir()}   where your SPLs, modules and metamodels live`,
        `  editor     ${session.editor ?? '(automatic)'}  → ${editor}`,
        `  server     ${session.baseUrl}`,
        `  theme      ${resolveTheme(process.env['LINEA_THEME'], session.theme).name}   the colours of the window (config theme lists them)`,
        `  signed in  ${session.authed ? (session.user?.username ?? 'yes') : 'no'}`,
        '',
        'Change one with: config <setting> <value>   (config editor --unset goes back to automatic).',
      ].join('\n');
    }

    // an old habit: `config <folder>` sets the workspace
    const key: Key = (KEYS as readonly string[]).includes(first) ? (first as Key) : 'workspace';
    const given = key === first ? value : first;

    switch (key) {
      case 'workspace': {
        if (!given) return `workspace: ${session.workdir ?? defaultDataDir()}`;
        const abs = ensureDir(given);
        updateSession({ workdir: abs });
        return `✓ Workspace set to ${abs}.`;
      }
      case 'editor': {
        if (unset) {
          updateSession({ editor: undefined });
          return '✓ Editor back to automatic ($VISUAL, $EDITOR, then VS Code / Cursor / VSCodium).';
        }
        if (!given) return `editor: ${session.editor ?? '(automatic)'}`;
        findEditor({ preferred: given }); // says when it is not on PATH
        updateSession({ editor: given });
        return `✓ Editor set to ${given}.`;
      }
      case 'theme': {
        if (unset) {
          updateSession({ theme: undefined });
          return `✓ Theme back to the default (${DEFAULT_THEME}). It applies the next time you open linea.`;
        }
        if (!given) {
          const current = resolveTheme(process.env['LINEA_THEME'], session.theme).name;
          return [
            'Themes:',
            ...THEMES.map((t) => `  ${t.name === current ? '●' : ' '} ${t.name.padEnd(12)} ${t.summary}`),
            '',
            'Choose one with: config theme <name>   (or LINEA_THEME=<name> for one run). It applies the next time you open linea.',
          ].join('\n');
        }
        const found = findTheme(given);
        if (!found) throw new Error(`No theme called "${given}". Themes: ${THEMES.map((t) => t.name).join(', ')}`);
        updateSession({ theme: found.name });
        return `✓ Theme set to ${found.name}. It applies the next time you open linea.`;
      }
      case 'server': {
        if (!given) return `server: ${session.baseUrl}`;
        if (!/^https?:\/\//.test(given)) throw new Error('The server is an address: http://… or https://…');
        const baseUrl = given.replace(/\/+$/, '');
        configureClient({ baseUrl });
        updateSession({ baseUrl });
        return `✓ Server set to ${given}. Sign in again with: login`;
      }
    }
  },
};

export const configCommands: Command[] = [config];
