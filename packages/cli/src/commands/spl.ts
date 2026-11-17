import path from 'node:path';
import { readOrigin } from '../core/gitops.js';
import { COMPOSED_MODEL_PATH, deleteLocalLine, listLocalProducts } from '../core/workspace.js';
import { isModularLine } from '../core/workspace.js';
import { displayPath } from '../core/workdir.js';
import { describeModules } from './modules.js';
import type { Command } from './types.js';
import { resolveLineDir } from './util.js';

const show: Command = {
  name: 'spl show',
  summary: 'An SPL: what it is made of, its products, and whether LINEA has it (the one you are in, or name one of your workspace)',
  usage: 'spl show [spl]',
  run: async ({ args, session, data }) => {
    const dir = resolveLineDir(session, args.find((a) => !a.startsWith('-')));
    const origin = readOrigin(dir);
    const products = listLocalProducts(dir);
    // (the feature model is UVL, composed from the SPL's own and its modules' when the SPL is checked)
    const type = 'UVL';
    const modelPath = path.join(dir, COMPOSED_MODEL_PATH);
    const info = { name: path.basename(dir), dir, modular: isModularLine(dir), onLinea: Boolean(origin), webUrl: origin?.webUrl, products: products.map((p) => p.name) };
    data?.(info);
    const lines = [
      `SPL: ${info.name} (${info.modular ? 'made of modules' : 'plain'})`,
      `  Folder:   ${displayPath(dir)}`,
      `  Model:    ${type}  (${displayPath(modelPath)})`,
      `  Products: ${products.length ? products.map((p) => p.name).join(', ') : '(none)'}`,
      `  LINEA:    ${origin ? origin.webUrl : 'not there yet (push uploads it)'}`,
    ];
    // an SPL made of modules says which: the ones it names, and what they bring in
    if (info.modular) lines.push('', await describeModules({ ...session, cwd: dir }));
    return lines.join('\n');
  },
};

const del: Command = {
  name: 'spl delete',
  summary: 'Delete an SPL from this machine, with all its products (irreversible). LINEA keeps its own copy',
  usage: 'spl delete [spl] --yes',
  run: ({ args, session, updateSession }) => {
    const target = args.find((a) => !a.startsWith('-'));
    const dir = resolveLineDir(session, target);
    const name = path.basename(dir);
    // naming it is what earns the one-step form: `--yes` alone is not enough to delete whatever folder you happen to be in
    if (!target || !args.includes('--yes')) {
      return `This permanently deletes "${name}" and every product inside it from this machine (${displayPath(dir)}). Re-run as: spl delete ${name} --yes`;
    }
    const onLinea = Boolean(readOrigin(dir));
    try {
      deleteLocalLine(dir);
    } catch (e) {
      // Windows does not delete a folder that a program (a terminal, an editor) has open
      if (/EBUSY|EPERM/.test((e as Error).message)) throw new Error(`${name} is in use (a terminal or an editor has it open, maybe this one). Leave it, close what uses it, and try again.`);
      throw e;
    }
    // the window may be standing in what was just deleted
    const here = path.resolve(session.cwd ?? process.cwd());
    if (here === dir || here.startsWith(dir + path.sep)) {
      const parent = path.dirname(dir);
      updateSession({ cwd: parent });
      if (session.interactive) process.chdir(parent);
    }
    return `✓ Deleted "${name}" from this machine.${onLinea ? ' It is still on LINEA: delete it there in the web interface, or get it again with: get ' + name : ''}`;
  },
};

export const splCommands: Command[] = [show, del];
