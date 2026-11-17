import fs from 'node:fs';
import path from 'node:path';
import { FEATURE_MODEL_PATH } from '@lbdudc/linea-core';
import { parseFlags, flagString } from '../core/args.js';
import { findContext } from '../core/context.js';
import { codeWorkspace, excludeFromGit, findEditor, launcher } from '../core/editor.js';
import { listLocalLines, listLocalProducts, localProductDir } from '../core/workspace.js';
import { getLocalLineModules, isModularLine, listLocalPackages } from '../core/workspace.js';
import { defaultDataDir, resolvePath } from '../core/workdir.js';
import { repo, web } from './bridge.js';
import type { Command, Session } from './types.js';

const workdirOf = (session: Session): string => session.workdir ?? defaultDataDir();

interface Resolved {
  /** what the editor is given */
  targets: string[];
  /** a line of the thing that is opened, for the answer */
  label: string;
  /** an SPL: a `.code-workspace` can bring its modules along */
  line?: { name: string; dir: string };
}

/** The model files of a product: `.linea/models/<metamodel>.<extension>` (`models/` in the SPLs made before). */
function modelFile(productDir: string, metamodel: string): string | undefined {
  for (const dir of [path.join(productDir, '.linea', 'models'), path.join(productDir, 'models')]) {
    try {
      const hit = fs.readdirSync(dir).find((f) => f.replace(/\.[^.]+$/, '') === metamodel);
      if (hit) return path.join(dir, hit);
    } catch {
      /* not there */
    }
  }
  return undefined;
}

/** The file that is the feature model of an SPL: a model of the feature metamodel, the one to edit (the composed UVL is made from it). */
function featureModelFile(lineDir: string): string {
  const own = path.join(lineDir, FEATURE_MODEL_PATH);
  if (fs.existsSync(own)) return own;
  throw new Error(`No feature model found in ${lineDir}.`);
}

/**
 * What a word means to `open`: a path, `fm`, a product (`shop`), a model of a product (`shop:datamodel`), a module or a metamodel of the
 * workspace, an SPL of it. With no word, the thing the folder you are in is: the product, else the SPL, else the workspace.
 */
export function resolveOpenTarget(session: Session, target: string | undefined): Resolved {
  const folder = findContext(session.cwd ?? process.cwd());
  const workdir = workdirOf(session);
  const lineDir = folder.line?.dir;
  const line = lineDir && fs.existsSync(lineDir) ? { name: path.basename(lineDir), dir: lineDir } : undefined;

  if (!target) {
    if (folder.product) return { targets: [folder.product.dir], label: `product ${folder.product.name}` };
    if (folder.line) return { targets: [folder.line.dir], label: `SPL ${folder.line.name}`, line: folder.line };
    if (line) return { targets: [line.dir], label: `SPL ${line.name}`, line };
    return { targets: [folder.workspace ?? workdir], label: 'the workspace' };
  }

  if (target === 'fm' || target === 'model') {
    if (!line) throw new Error('No SPL here: run it inside one, or pick one with: use <spl>.');
    return { targets: [featureModelFile(line.dir)], label: `the feature model of ${line.name}` };
  }

  if (target.includes(':') && !/^(gitlab|github|file):/.test(target)) {
    const [productName, metamodel] = target.split(':') as [string, string];
    if (!line) throw new Error('No SPL here: run it inside one, or pick one with: use <spl>.');
    const productDir = localProductDir(line.dir, productName);
    if (!listLocalProducts(line.dir).some((p) => p.name === productName)) throw new Error(`No product "${productName}" in ${line.name}.`);
    const file = modelFile(productDir, metamodel);
    if (!file) throw new Error(`${productName} has no model of "${metamodel}". See: product show ${productName}.`);
    return { targets: [file], label: `the ${metamodel} model of ${productName}` };
  }

  if (/^(gitlab|github):/.test(target)) {
    throw new Error(`${target} is on the git host, not in your workspace. Get it first: get ${target}`);
  }

  if (line && listLocalProducts(line.dir).some((p) => p.name === target)) {
    return { targets: [localProductDir(line.dir, target)], label: `product ${target}` };
  }
  const pkg = listLocalPackages(workdir).find((p) => p.name === target);
  if (pkg) return { targets: [pkg.dir], label: `${pkg.kind} ${pkg.name}` };
  const spl = listLocalLines(workdir).find((l) => l.name.toLowerCase() === target.toLowerCase());
  if (spl) return { targets: [spl.dir], label: `SPL ${spl.name}`, line: spl };

  const asPath = resolvePath(target);
  if (fs.existsSync(asPath)) return { targets: [asPath], label: asPath };
  throw new Error(`Nothing called "${target}": not a product, module, metamodel or SPL of ${workdir}, and not a path.`);
}

/** Writes the `.code-workspace` of an SPL: the SPL, and the local modules and metamodels it uses, one folder each. */
export async function writeCodeWorkspace(session: Session, line: { name: string; dir: string }): Promise<string> {
  const file = path.join(line.dir, '.linea', `${line.name}.code-workspace`);
  const folders = [{ name: `${line.name} (SPL)`, path: '..' }];
  if (isModularLine(line.dir)) {
    try {
      const view = await getLocalLineModules(path.dirname(line.dir), line.dir);
      for (const p of view.packages) {
        if (!p.location.startsWith('file:')) continue;
        const dir = path.join(path.dirname(line.dir), p.location.slice('file:'.length));
        if (fs.existsSync(dir)) folders.push({ name: `${p.name} (${p.kind})`, path: path.relative(path.dirname(file), dir).replace(/\\/g, '/') });
      }
    } catch {
      // the modules do not resolve right now: the SPL alone still opens
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, codeWorkspace({ name: line.name, folders }));
  excludeFromGit(line.dir, '.linea/*.code-workspace');
  return file;
}

const open: Command = {
  name: 'open',
  summary: 'Open the SPL, product, model, module or folder you mean in your editor (VS Code and the like)',
  usage: 'open [what] [--editor code|cursor|…] [--print] [--web] [--repo]   what: fm · <product> · <product>:<metamodel> · <module> · <path>',
  flags: ['--editor name', '--print', '--web (LINEA in the browser)', '--repo (the GitLab/GitHub page)'],
  arg: 'product',
  run: async (ctx) => {
    const { args, session } = ctx;
    const { positional, flags } = parseFlags(args, { value: { editor: 'e' }, bool: { print: 'p' } });
    // the same thing in the browser: its page in LINEA, or in the git host
    if (flags['web'] || flags['repo']) {
      const rest = args.filter((a) => a !== '--web' && a !== '--repo');
      return (flags['web'] ? web : repo).run({ ...ctx, args: rest });
    }
    const where = resolveOpenTarget(session, positional[0]);
    const editor = findEditor({ preferred: flagString(flags, 'editor') ?? session.editor });
    if (!editor) {
      throw new Error('No editor found. Install VS Code (the `code` command), or say which: open --editor <command>, config editor <command>, or set $EDITOR.');
    }
    let targets = where.targets;
    // an SPL opens with the modules and metamodels it uses next to it, in the editors that know workspaces
    if (where.line && editor.workspaces) targets = [await writeCodeWorkspace(session, where.line)];
    if (flags['print']) return [`${editor.name} ${targets.map((t) => `"${t}"`).join(' ')}`].join('\n');
    if (!editor.windowed && session.interactive) {
      throw new Error(`${editor.name} is a terminal editor and cannot start inside this window. Run it from your shell: linea open${positional[0] ? ' ' + positional[0] : ''}`);
    }
    launcher.start(editor, targets);
    return `✓ Opened ${where.label} in ${editor.name}.`;
  },
};

export const openCommands: Command[] = [open];
