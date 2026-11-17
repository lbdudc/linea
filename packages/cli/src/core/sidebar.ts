import type { Session } from '../commands/types.js';
import { findContext, type FolderContext } from './context.js';
import { listLocalLines, listLocalPackages, listLocalProducts, localProductDir } from './workspace.js';

/**
 * What the side panel lists: the SPLs of the workspace, the products of the one you are in, and the modules and metamodels the
 * workspace has; and, once signed in, what LINEA and the git host have that is not here. Names only (a folder walk, no git): what is
 * changed or waiting is told by the footer and `status`.
 */

/** Where a thing is, the way `spl list` says it: `here + LINEA`, `here only`, `LINEA only`. */
export type Where = 'both' | 'here' | 'remote';

export interface SidebarEntry {
  name: string;
  kind: 'SPL' | 'product' | 'module' | 'metamodel';
  where: Where;
  /** the folder, when it is here */
  dir?: string;
  /** on the host: the web address of an SPL's repository, or the `gitlab:group/project` location of a package */
  remote?: string;
  /** the SPL or product you are standing in */
  current?: boolean;
  /** for a product: the SPL it is in */
  of?: string;
}

export interface SidebarModel {
  /** whether `where` means anything: without a sign-in only what is here is known */
  signedIn: boolean;
  /** the SPLs; the products are listed only under the one you are in */
  lines: (SidebarEntry & { products: SidebarEntry[] })[];
  modules: SidebarEntry[];
  metamodels: SidebarEntry[];
}

export interface RemoteItem {
  name: string;
  ref?: string;
}

export interface RemoteNames {
  lines: readonly RemoteItem[];
  modules: readonly RemoteItem[];
  metamodels: readonly RemoteItem[];
}

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

/** Local things first as they are, the remote ones merged by name: the ones in both are told from those on one side. */
function merge<T extends SidebarEntry>(here: T[], remote: readonly RemoteItem[] | undefined, signedIn: boolean, make: (r: RemoteItem) => T): T[] {
  if (!signedIn) return here.sort(byName);
  const known = new Map((remote ?? []).map((r) => [r.name, r]));
  const out = here.map((e) => {
    const found = known.get(e.name);
    known.delete(e.name);
    return found ? { ...e, where: 'both' as const, ...(found.ref ? { remote: found.ref } : {}) } : e;
  });
  for (const r of known.values()) out.push(make(r));
  return out.sort(byName);
}

export function sidebarOf(session: Session, folder: FolderContext, remote?: RemoteNames): SidebarModel {
  const root = folder.workspace ?? session.workdir;
  const signedIn = Boolean(session.authed);
  const local = root ? listLocalLines(root) : [];
  const here = local.map((l): SidebarEntry & { products: SidebarEntry[] } => ({
    name: l.name,
    kind: 'SPL',
    where: 'here',
    dir: l.dir,
    current: folder.line?.name === l.name,
    products:
      folder.line?.name === l.name
        ? listLocalProducts(l.dir).map(
            (p): SidebarEntry => ({
              name: p.name,
              kind: 'product',
              where: 'here',
              dir: localProductDir(l.dir, p.name),
              of: l.name,
              current: folder.product?.name === p.name,
            }),
          )
        : [],
  }));
  const lines = merge(here, remote?.lines, signedIn, (r): SidebarEntry & { products: SidebarEntry[] } => ({
    name: r.name,
    kind: 'SPL',
    where: 'remote',
    ...(r.ref ? { remote: r.ref } : {}),
    products: [],
  }));

  const packages = root ? listLocalPackages(root) : [];
  const packagesOf = (kind: 'module' | 'metamodel', found: readonly RemoteItem[] | undefined): SidebarEntry[] =>
    merge(
      packages.filter((p) => p.kind === kind).map((p): SidebarEntry => ({ name: p.name, kind, where: 'here', dir: p.dir })),
      found,
      signedIn,
      (r) => ({ name: r.name, kind, where: 'remote', ...(r.ref ? { remote: r.ref } : {}) }),
    );

  return { signedIn, lines, modules: packagesOf('module', remote?.modules), metamodels: packagesOf('metamodel', remote?.metamodels) };
}
