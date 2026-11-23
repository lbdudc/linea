import Line from '../entities/line.js';
import Product from '../entities/product.js';
import { AlreadyExistentLineError, LineNotFoundError, ProductNotFoundError, RestoreBlockedError, isLineDeleted, MembersOnHostError, UserNotFoundError, NoDeployedSnapshotError } from '../errors/errors.js';
import { ciKindOf, getGitProvider, hostDescriptor } from '../git/index.js';
import { activeHostOf, hostOf, tokenFor } from '../git/hosts.js';
import {
  emptyProductsIndex, serializeProductsIndex, PRODUCTS_INDEX_PATH,
  normalizeProductSpec, parseSplManifest, serializeLock, LOCK_PATH,
  extractArchive,
} from '@lbdudc/linea-core';
import { buffer as streamToBuffer } from 'node:stream/consumers';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Container } from 'typedi';
import UserRepository from '../repositories/UserRepository.js';
import DataSource from '../connectors/DataSource.js';
import LineRepository from '../repositories/LineRepository.js';
import PermissionChecker from './PermissionChecker.js';
import ProductRepository from '../repositories/ProductRepository.js';
import ProductSpecService, { ProductSpecUnavailableError, fallbackSpecOf } from './ProductSpecService.js';
import ModularService, { forgetLineProject } from './modules/ModularService.js';
import domainEvents, { DOMAIN_EVENTS } from '../events/domainEvents.js';
import { createRecent, mapLimit } from './recent.js';
import { singleFlight } from './singleFlight.js';
import { createdAtOf, correctLineDates, correctProductDates } from './hostDates.js';

import { readLineVersion, listLineVersionNames, packagesOf, keepLineVersion } from './lineVersions.js';
import { compareVersions, isVersion } from './versionTags.js';
import { ACCESS, deleteLineOnHost, restoreLineOnHost, restoreProductOnHost } from '@lbdudc/linea-git';

const SPEC_READ_CHUNK_SIZE = 5;
const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// the groups a user can create a line in: the creation form asks for them and the host takes seconds to list them
const namespaces = createRecent({ ttlMs: 60_000, limit: 200 });
/** Forgets the groups listed so far: the hosts changed. */
export const forgetNamespaces = () => namespaces.clear();

export default class LineService {
  dataSource = Container.get(DataSource);
  permissionChecker = Container.get(PermissionChecker);
  userRepository = Container.get(UserRepository);
  lineRepository = Container.get(LineRepository);
  productRepository = Container.get(ProductRepository);
  productSpecService = Container.get(ProductSpecService);
  modularService = Container.get(ModularService);

  createLine = async ({ userId, name, version, description, kind = 'plain', metamodels = {}, modules = {}, parentNamespaceId, host }) => {
    const creator = await this.userRepository.findById(userId);
    if (!creator) throw new UserNotFoundError();
    // the host of their profile unless the caller says another
    host ??= activeHostOf(creator);
    const git = getGitProvider({ host });
    // their token on this host, before anything is made: a person who never signed in to it cannot create the line there
    const token = tokenFor(creator, host);
    // what the SPL is made of is resolved and checked before anything is created: its feature metamodel (every SPL has it), the metamodels
    // of a project, the modules of a modular one. What comes back is what to commit.
    const initial = await this.modularService.previewLine({ userId, name, kind, metamodels, modules, strict: true, ci: ciKindOf(host), host });
    const session = await this.dataSource.startTransaction();
      try {
          const foundLine = await this.lineRepository.findByName(name, { session });

          if (foundLine) {
              throw new AlreadyExistentLineError();
          }

          const line = new Line({ name, version, description, kind, metamodels: kind === 'project' ? Object.keys(metamodels) : [], ownerId: userId, gitHost: host });
          await this.lineRepository.save(line, { session });

          // The parent is whichever group the user picked (see
          // findAvailableNamespaces); omitted means a top-level group. GitLab
          // rejects the call if their token may not create there.
          const group = await git.createNamespace({ token, name: line.name, parentId: parentNamespaceId ?? undefined });
          const repo = await git.createRepository({ token, name: line.name, namespaceId: group.id, topics: ['spl'] });
          // the namespace of a line is the one its repository says it is in (on some hosts it only exists once the repository does)
          line.namespaceId = repo.namespaceId ?? group.id;

          // Every line is the same thing: its manifest (`spl.json`: its kind, its metamodels, its modules), the lockfile that pins what they
          // resolve to, and its feature model (a model of the feature metamodel). A plain or project one also has the platform its products
          // are derived with; a modular one gets it from its modules.
          const files = [...initial.files, { path: LOCK_PATH, content: serializeLock({ lock: initial.lock }) }];
          for (const f of files) {
            await git.createFile({ token, id: repo.id, path: f.path, branch: 'main', content: f.content });
          }

          await git.createFile({
            token, id: repo.id, path: PRODUCTS_INDEX_PATH, branch: 'main', content: serializeProductsIndex({ index: emptyProductsIndex() }),
          });

          line.repoId = repo.id;
          line.webUrl = repo.webUrl;
          line.webIdeUrl = repo.webIdeUrl;
  
          await this.lineRepository.save(line, { session });
  
          await this.dataSource.commitTransaction(session);
          namespaces.clear();

          // The version a line is made with is a version like any other: it gets its tag (with what the line was) and its release. The
          // history is a convenience of the creation, so a failure is recorded and never fails it (see `keepLineVersion`).
          await keepLineVersion({
            token, host, projectId: repo.id, version: line.version, name: line.name,
            snapshot: {
              modular: kind === 'modular',
              featureModel: typeof initial.featureModel === 'string' ? { type: 'UVL', content: initial.featureModel } : null,
              modules: kind === 'modular' ? initial.spl?.modules ?? null : null,
              packages: packagesOf(initial.packages),
            },
          });

          // Dev convenience only: LINEA_LOCAL_EXPORT_DIR is set by the local dev stack
          // (server/dev/up.sh), never in production, so this never runs there.
          if (process.env.LINEA_LOCAL_EXPORT_DIR) {
            const zip = await git.downloadArchive({ token, id: repo.id });
            const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-export-'));
            try {
              const { dir } = await extractArchive({ source: await streamToBuffer(zip), destDir: scratch, prefix: '' });
              const dest = path.join(process.env.LINEA_LOCAL_EXPORT_DIR, line.name);
              fs.rmSync(dest, { recursive: true, force: true });
              fs.cpSync(dir, dest, { recursive: true });
            } finally {
              fs.rmSync(scratch, { recursive: true, force: true });
            }
          }

          return line;
      } catch (error) {
          // the client only gets "error connecting to GitLab": what the host said (a group it will not create, a name taken) stays here
          console.error(`[createLine] "${name}" (parent namespace ${parentNamespaceId ?? 'none'}) failed: ${error?.name ?? 'Error'}: ${error?.message ?? error}`);
          await this.dataSource.abortTransaction(session);
          await git.rollback();
          throw error;
      }
  }
  
  /**
   * GitLab groups the user could create a line's group under. Drives the
   * namespace picker in the creation form; an empty list is legitimate and
   * simply means the line will become a top-level group.
   */
  findAvailableNamespaces = async ({ userId, host }) => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    host ??= activeHostOf(user);

    const git = getGitProvider({ host });
    const token = tokenFor(user, host);
    const available = await namespaces.get(`${host}|${String(token).slice(-12)}`, () => git.listNamespaces({ token }));
    if (!hostDescriptor(host).groupPerRepository) return available;
    // on the local host every line and every product has a group of its own, and they are not places to put a line in
    const [lineGroups, productGroups] = await Promise.all([Line.distinct('namespaceId'), Product.distinct('repo.namespaceId')]);
    const own = new Set([...lineGroups, ...productGroups].map(String));
    return available.filter((namespace) => !own.has(String(namespace.id)));
  };

  /** What the repository of a line says it is made of (a repository that has no `spl.json` is taken for a plain line). */
  #kindOfRepository = async ({ git, token, id }) => (await this.#manifestOf({ git, token, id }))?.kind ?? 'plain';

  #manifestOf = async ({ git, token, id }) => {
    const manifest = await git.readFile({ token, id, path: 'spl.json', ref: 'main' });
    return manifest ? parseSplManifest({ content: manifest.toString('utf8') }) : null;
  };

  /** What the list of lines says of one, for one waiting to be deleted: LINEA may have forgotten it, and then its repository says. */
  #attributesOfInactive = async ({ git, token, line, known }) => {
    const manifest = known ? null : await this.#manifestOf({ git, token, id: line.id }).catch(() => null);
    return {
      kind: known?.kind ?? manifest?.kind ?? 'plain',
      version: known?.version ?? manifest?.version ?? null,
      createdAt: line.createdAt ?? known?.createdAt ?? null,
    };
  };

  #attributesOfInactiveProduct = async ({ token, host, product, known }) => {
    const basicData = known?.spec?.basicData
      ?? (await this.productSpecService.readSpec({ token, productProjectId: product.id, host }).catch(() => null))?.basicData;
    return {
      version: basicData?.version ?? null,
      createdAt: product.createdAt ?? basicData?.createdAt ?? null,
    };
  };

  // LINEA shows one remote at a time: the lines of the host of the person's profile
  #hostsOf = (user) => [activeHostOf(user)];

  /** What the host is about to delete for good, whether LINEA still knows it or not: a product is in a group inside the one of its line. */
  #inactiveOn = async ({ user, host }) => {
    const git = getGitProvider({ host });
    const token = tokenFor(user, host);
    const [lines, products] = await Promise.all([
      git.listPendingDeletion({ token, topic: 'spl' }),
      git.listPendingDeletion({ token, topic: 'product' }),
    ]);
    const shown = ({ id, name, path, webUrl, deletesOn, namespaceId, parentNamespaceId }) => ({ _id: `${host}:${id}`, repoId: id, gitHost: host, name, path, webUrl, deletesOn, namespaceId, parentNamespaceId });
    const canRestore = (id) => this.permissionChecker.hasPrivileges({ userId: user._id, repoId: id, accessLevel: ACCESS.OWNER }, git).catch(() => true);
    const pendingLines = new Map(lines.map((line) => [line.namespaceId, line.name]));
    return {
      lines: async () => {
        const known = await this.lineRepository.findByRepoIdsOrderByCreatedAtDesc(lines.map((line) => line.id), undefined, host);
        return Promise.all(lines.map(async (line) => ({
          ...shown(line),
          ...(await this.#attributesOfInactive({ git, token, line, known: known.find((record) => record.repoId === line.id) })),
          productCount: products.filter((product) => product.parentNamespaceId === line.namespaceId).length,
          canRestore: await canRestore(line.id),
        })));
      },
      products: async () => {
        const known = await this.productRepository.findByRepoIdsOrderByCreatedAtDesc(products.map((product) => product.id), undefined, host);
        return Promise.all(products.map(async (product) => ({
          ...shown(product),
          ...(await this.#attributesOfInactiveProduct({ token, host, product, known: known.find((record) => record.repo?.id === product.id) })),
          line: pendingLines.get(product.parentNamespaceId) ?? (await this.lineRepository.findByNamespaceId(product.parentNamespaceId, undefined, host))?.name ?? null,
          canRestore: await canRestore(product.id),
          lineFirst: product.ancestorScheduled === true || pendingLines.has(product.parentNamespaceId),
        })));
      },
    };
  };

  #inactive = async ({ userId }) => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    return Promise.all(this.#hostsOf(user).map((host) => this.#inactiveOn({ user, host })));
  };

  findInactiveLines = async ({ userId }) => (await Promise.all((await this.#inactive({ userId })).map(({ lines }) => lines()))).flat();

  findInactiveProducts = async ({ userId }) => (await Promise.all((await this.#inactive({ userId })).map(({ products }) => products()))).flat();

  #pendingOf = async ({ userId }) => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    const host = activeHostOf(user);
    const git = getGitProvider({ host });
    const token = tokenFor(user, host);
    const [lines, products] = await Promise.all([
      git.listPendingDeletion({ token, topic: 'spl' }),
      git.listPendingDeletion({ token, topic: 'product' }),
    ]);
    return { host, git, token, lines, products };
  };

  #rememberRestored = async ({ pending, host, git, token, userId }) => {
    const repository = await git.getRepository({ token, id: pending.id }).catch(() => null);
    const [known] = await this.lineRepository.findByRepoIdsOrderByCreatedAtDesc([pending.id], undefined, host);
    const place = {
      namespaceId: repository?.namespaceId ?? pending.namespaceId,
      webUrl: repository?.webUrl ?? pending.webUrl,
      webIdeUrl: repository?.webIdeUrl ?? '',
    };
    if (known) {
      if (known.deletedAt) known.name = known.deletedName ?? pending.name;
      Object.assign(known, place, { deletedAt: null, deletedName: null, archived: false });
      return this.lineRepository.save(known);
    }
    const manifest = await this.#manifestOf({ git, token, id: pending.id }).catch(() => null);
    return this.lineRepository.save(new Line({
      ...place,
      name: pending.name,
      version: manifest?.version ?? '1.0.0',
      description: repository?.description ?? '',
      gitHost: host,
      repoId: pending.id,
      kind: manifest?.kind ?? 'plain',
      ownerId: userId,
      ...createdAtOf(repository ?? pending),
    }));
  };

  restoreLine = async ({ repoId, productRepoIds, userId }) => {
    const { host, git, token, lines, products } = await this.#pendingOf({ userId });
    const pending = lines.find((line) => String(line.id) === String(repoId));
    if (!pending) throw new LineNotFoundError();
    if (pending.ancestorScheduled) throw new RestoreBlockedError();
    const namesake = await this.lineRepository.findByName(pending.name);
    if (namesake && namesake.repoId !== pending.id) throw new AlreadyExistentLineError();
    await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: pending.id, accessLevel: ACCESS.OWNER }, git);

    const plan = await restoreLineOnHost({
      provider: git,
      token,
      line: pending,
      products: products.filter((product) => product.parentNamespaceId === pending.namespaceId),
      restoreProductIds: productRepoIds?.map(String),
    });
    const line = await this.#rememberRestored({ pending, host, git, token, userId });
    return { id: line._id, restoredProductIds: plan.restoredProductIds, pendingProductIds: plan.pendingProductIds };
  };

  restoreProduct = async ({ repoId, userId }) => {
    const { git, token, lines, products } = await this.#pendingOf({ userId });
    const pending = products.find((product) => String(product.id) === String(repoId));
    if (!pending) throw new ProductNotFoundError();
    if (pending.ancestorScheduled || lines.some((line) => line.namespaceId === pending.parentNamespaceId)) throw new RestoreBlockedError();
    await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: pending.id, accessLevel: ACCESS.OWNER }, git);
    await restoreProductOnHost({ provider: git, token, product: pending });
    return { repoId: pending.id };
  };

  findEnrolledLines = async ({ userId }) => {
    try {
      const user = await this.userRepository.findById(userId);
      if (!user) throw new UserNotFoundError();

      const lists = await Promise.all(this.#hostsOf(user).map((host) => this.#enrolledOn({ user, host, userId })));
      return lists.flat().filter((line) => !line.deletedAt).sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
      console.error('[findEnrolledLines] error:', error.constructor.name, error.message, error.code ?? '');
      throw error;
    }
  };

  #enrolling = singleFlight();

  /** The lines of a user on one host: the `spl` repositories their token reaches there, made lines here when they were not. */
  #enrolledOn = ({ user, host, userId }) => this.#enrolling(`${host}:${userId}`, () => this.#loadEnrolledOn({ user, host, userId }));

  #loadEnrolledOn = async ({ user, host, userId }) => {
    const git = getGitProvider({ host });
    const token = tokenFor(user, host);
    const gitlabProjects = await git.listRepositories({ token, topic: 'spl' });
    const repoIds = gitlabProjects.map(p => p.id);

    const existing = await this.lineRepository.findByRepoIdsOrderByCreatedAtDesc(repoIds, undefined, host);
    const existingIds = new Set(existing.map(l => l.repoId));
    const newProjects = gitlabProjects.filter(p => !existingIds.has(p.id));

    for (const project of newProjects) {
      const existingByName = await this.lineRepository.findByName(project.name);
      if (existingByName && hostOf(existingByName) !== host) {
        console.warn(`[findEnrolledLines] "${project.name}" on ${host} is left out: a line of that name is on ${hostOf(existingByName)}`);
      } else if (existingByName) {
        existingByName.repoId = project.id;
        existingByName.namespaceId = project.namespaceId;
        existingByName.webUrl = project.webUrl;
        existingByName.webIdeUrl = project.webIdeUrl;
        Object.assign(existingByName, createdAtOf(project));
        await this.lineRepository.save(existingByName);
      } else {
        const line = new Line({
          name: project.name,
          version: '1.0.0',
          description: project.description || '',
          gitHost: host,
          repoId: project.id,
          namespaceId: project.namespaceId,
          webUrl: project.webUrl,
          webIdeUrl: project.webIdeUrl,
          // listing lines must not fail for a repository that cannot be read right now: it is taken for plain and the kind is corrected when it is
          kind: await this.#kindOfRepository({ git, token, id: project.id }).catch(() => 'plain'),
          ownerId: userId,
          ...createdAtOf(project),
        });
        // (another process may have made it a moment ago: the name is unique, and the line is there either way)
        await this.lineRepository.save(line).catch((error) => {
          if (error.code !== 11000) throw error;
        });
      }
    }

    await correctLineDates({ lines: existing, projects: gitlabProjects, repository: this.lineRepository });

    if (newProjects.length === 0) return existing;
    return this.lineRepository.findByRepoIdsOrderByCreatedAtDesc(repoIds, undefined, host);
  };

  reconcileLines = async ({ userId, prune = false }) => {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();

    const total = { created: [], skipped: 0, archived: [] };
    for (const host of this.#hostsOf(user)) {
      const done = await this.#reconcileOn({ user, host, userId, prune });
      total.created.push(...done.created);
      total.skipped += done.skipped;
      total.archived.push(...done.archived);
    }
    return total;
  };

  #reconcileOn = async ({ user, host, userId, prune }) => {
    const git = getGitProvider({ host });
    const token = tokenFor(user, host);
    const gitlabProjects = await git.listRepositories({ token, topic: 'spl' });

    const repoIds = gitlabProjects.map(p => p.id);
    const liveIdSet = new Set(repoIds);
    const existing = await this.lineRepository.findByRepoIdsOrderByCreatedAtDesc(repoIds, undefined, host);
    const existingIds = new Set(existing.map(l => l.repoId));

    const newProjects = gitlabProjects.filter(p => !existingIds.has(p.id));
    const created = [];

    for (const project of newProjects) {
      // what the repository says it is made of (a line that has no `spl.json` is taken for a plain one: it is not supported until it has one)
      const kind = await this.#kindOfRepository({ git, token, id: project.id });

      const line = new Line({
        name: project.name,
        version: '1.0.0',
        description: project.description || '',
        gitHost: host,
        repoId: project.id,
        namespaceId: project.namespaceId,
        webUrl: project.webUrl,
        webIdeUrl: project.webIdeUrl,
        kind,
        ownerId: userId,
        ...createdAtOf(project),
      });

      await this.lineRepository.save(line);
      created.push({ id: line._id, name: line.name });
    }

    // Prune: archive DB lines of this host whose project no longer appears in the user's enrolled list.
    const archived = [];
    if (prune) {
      const allLines = await this.lineRepository.getAll();
      for (const line of allLines) {
        if (line.archived || hostOf(line) !== host) continue;
        if (line.repoId && !liveIdSet.has(line.repoId)) {
          line.archived = true;
          await this.lineRepository.save(line);
          archived.push({ id: line._id, name: line.name });
        }
      }
    }

    return { created, skipped: existing.length, archived };
  };

  findProductsByLineId = async ({ id, userId, specFromRepo = false, cutOnInfra = false }) => {
    const line = await this.lineRepository.findById(id);
    if (!line) throw new LineNotFoundError();
    const git = getGitProvider({ host: hostOf(line) });

    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({userId, repoId: line.repoId, accessLevel: ACCESS.REPORTER}, git);

    const products = await this.productRepository.findByLineId(id);

    const token = tokenFor(user, hostOf(line));

    // Self-heal products whose GitLab project is no longer live — archived,
    // marked for delayed deletion, or removed outright — even when nothing in
    // LINEA's own delete flow ran (e.g. deleted directly on GitLab).
    // getEnrolledProjects already excludes exactly those, so anything tracked
    // locally but missing from it qualifies for cleanup. Showing it instead
    // (flagged, with working action buttons) just multiplies the ways a stale
    // GitLab reference can error — deleting the stray local record here is
    // safe: there's nothing left on GitLab for it to protect. Best-effort: a
    // GitLab hiccup shouldn't break the products list, so on failure this
    // just returns everything unfiltered rather than guessing.
    let live;
    try {
      const enrolled = await git.listRepositories({ token, topic: 'product' });
      const enrolledIds = new Set(enrolled.map((p) => p.id));
      const gone = products.filter((p) => !enrolledIds.has(p.repo.id));
      await Promise.all(gone.map((p) => this.productRepository.deleteById(p._id).catch((error) => console.error(`[LineService] could not forget product ${p._id}, whose repository is gone:`, error))));
      live = products.filter((p) => enrolledIds.has(p.repo.id));
      await correctProductDates({ products: live, projects: enrolled, repository: this.productRepository });
    } catch (err) {
      console.error('[LineService] deletion-scheduled cleanup skipped:', err?.message ?? err);
      live = products;
    }

    // Reading the spec runs on the survivors only: a product already gone
    // from GitLab has no .linea/spec.draft.json left to read.
    if (!specFromRepo) return live;

    for (const chunk of chunkArray(live, SPEC_READ_CHUNK_SIZE)) {
      await Promise.all(chunk.map(async (product) => {
        const { spec: resolvedSpec, source, reason } = await this.productSpecService.getSpecFromHostOrCache({
          token, host: hostOf(product), productProjectId: product.repo.id, fallbackSpec: fallbackSpecOf(product),
          context: `findProductsByLineId(specFromRepo: true): product ${product._id}`,
        });
        if (cutOnInfra && reason === 'infra') {
          throw new ProductSpecUnavailableError(
            `No se pudo leer .linea/spec.draft.json del producto ${product._id} (línea ${id}) en GitLab (red, 5xx, o ` +
            'permisos) — no se sabe si el modelo propuesto sigue siendo válido para ese producto. Se cancela la ' +
            'operación para no escribir un cambio de línea validado contra un producto desconocido. Reintenta ' +
            'cuando el fallo se resuelva (si era de red o GitLab estaba caído) o revisa los permisos del token.'
          );
        }
        product.spec = source === 'repo' ? normalizeProductSpec({ spec: resolvedSpec }) : resolvedSpec;
      }));
    }

    return live;

  }

  findProductsCountByLineId = async ({ id, userId }) => {
    const line = await this.lineRepository.findById(id);
    if (!line) throw new LineNotFoundError();
    const git = getGitProvider({ host: hostOf(line) });
    await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: line.repoId, accessLevel: ACCESS.REPORTER }, git);
    return this.productRepository.countByLineId(id);
  }

  getLinesDeletable = async ({ ids, userId }) => {
    const entries = await mapLimit(ids, 6, async (id) => {
      try {
        const line = await this.lineRepository.findById(id);
        if (!line) return null; // an id nobody has is left out of the answer
        if (isLineDeleted(line)) return [id, false];
        return [id, await this.permissionChecker.hasPrivileges({ userId, repoId: line.repoId, accessLevel: ACCESS.OWNER }, getGitProvider({ host: hostOf(line) }))];
      } catch {
        return null;
      }
    });
    return Object.fromEntries(entries.filter(Boolean));
  };

  deleteLine = async ({ id, userId, keepProductIds = [] }) => {
    const line = await this.lineRepository.findById(id);
    if (isLineDeleted(line)) throw new LineNotFoundError();
    const git = getGitProvider({ host: hostOf(line) });
    const products = await this.productRepository.findByLineId(id);
    const keep = keepProductIds.map(String);
    const session = await this.dataSource.startTransaction();
      try {
          const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({userId, repoId: line.repoId, accessLevel: ACCESS.OWNER}, git);

          const token = tokenFor(user, hostOf(line));

          if (keep.length > 0) {
            const enrolled = await git.listRepositories({ token, topic: 'product' }).catch(() => null);
            const live = products.filter((product) => !keep.includes(String(product._id)) && (enrolled === null || enrolled.some((p) => p.id === product.repo.id)));
            for (const product of live) {
              await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel: ACCESS.OWNER }, git);
            }
          }

          const plan = await deleteLineOnHost({
            provider: git,
            token,
            line: { repositoryId: line.repoId, namespaceId: line.namespaceId },
            products: products.map((product) => ({ id: String(product._id), repositoryId: product.repo.id, namespaceId: product.repo.namespaceId })),
            keepProductIds: keep,
          });

          if (plan.lineSurvives) {
            for (const productId of plan.deletedProductIds) await this.productRepository.deleteById(productId, { session });
            line.deletedName = line.name;
            line.name = `${line.name}~deleted-${line._id}`;
            line.deletedAt = new Date();
            line.archived = true;
            await this.lineRepository.save(line, { session });
          } else {
            await this.productRepository.deleteByLineId(id, { session });
            await this.lineRepository.deleteById(id, { session });
          }

          await this.dataSource.commitTransaction(session);
          forgetLineProject(line.repoId);

        } catch (error) {
          await this.dataSource.abortTransaction(session);
          await git.rollback();
          throw error;
        }
  }

  describeLineOfProduct = async ({ lineId, userId }) => {
    const line = await this.lineRepository.findById(lineId);
    if (isLineDeleted(line)) return { name: line?.deletedName ?? line?.name ?? null, deleted: true };
    return this.findLineById({ id: lineId, userId }).then((found) => ({ name: found.name, deleted: false }), () => ({ name: null, deleted: false }));
  };

  deletesLater = (owner) => Boolean(getGitProvider({ host: hostOf(owner) }).capabilities().deletion?.delayed);
  
  findLineById = async ({ id, userId }) => {
    const line = await this.lineRepository.findById(id);
    if (!line) throw new LineNotFoundError();
    const git = getGitProvider({ host: hostOf(line) });
  
    await this.permissionChecker.checkUserExistsAndHasPrivileges({userId, repoId: line.repoId, accessLevel: ACCESS.REPORTER}, git);
  
    return line;
  
  }

  findMembersByLineId = async ({ id, userId }) => {
    const line = await this.lineRepository.findById(id);
    if (!line) throw new LineNotFoundError();
    const git = getGitProvider({ host: hostOf(line) });
  
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({userId, repoId: line.repoId, accessLevel: ACCESS.REPORTER}, git);
  
    const members = await git.getMembers({ token: tokenFor(user, hostOf(line)), id: line.repoId });
  
    return members;
  
  }
  
  // ── who works on the line, on a host that has no members of its own to manage (the local one) ──────────────────────────

  async #membersOfLocalLine({ id, userId }) {
    const line = await this.lineRepository.findById(id);
    if (!line) throw new LineNotFoundError();
    const host = hostOf(line);
    if (!hostDescriptor(host).managesMembers) throw new MembersOnHostError(host);
    const git = getGitProvider({ host });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: line.repoId, accessLevel: ACCESS.OWNER }, git);
    return { line, git, token: tokenFor(user, host) };
  }

  /** Gives a person a level in the line (reporter 20, developer 30, maintainer 40); only on a line of the local host, and only its owner. */
  setMember = async ({ id, userId, username, accessLevel }) => {
    const { line, git, token } = await this.#membersOfLocalLine({ id, userId });
    // (a name nobody here has would be a place held for whoever makes the account later)
    const person = await this.userRepository.findByUsername(username);
    if (!person || person.gitHost !== 'local') throw new UserNotFoundError();
    await git.setMember({ token, id: line.repoId, username: person.username, accessLevel });
    return this.findMembersByLineId({ id, userId });
  }

  removeMember = async ({ id, userId, username }) => {
    const { line, git, token } = await this.#membersOfLocalLine({ id, userId });
    await git.removeMember({ token, id: line.repoId, username });
    return this.findMembersByLineId({ id, userId });
  }

  /** The feature model of a line (see `ModularService.getLineFeatureModel`). */
  getFeatureModel = async ({ id, userId }) => this.modularService.getLineFeatureModel({ id, userId });

  /** Saves the feature model of a line, a model of the feature metamodel (see `ModularService.saveLineFeatureModel`). */
  saveFeatureModel = async ({ id, userId, content, bump = 'minor', metamodel }) => this.modularService.saveLineFeatureModel({ id, userId, content, bump, ...(metamodel ? { metamodel } : {}) });

  #versionContext = async ({ id, userId }) => {
    const line = await this.lineRepository.findById(id);
    if (!line) throw new LineNotFoundError();
    const git = getGitProvider({ host: hostOf(line) });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: line.repoId, accessLevel: ACCESS.REPORTER }, git);
    return { line, token: tokenFor(user, hostOf(line)), projectId: line.repoId, host: hostOf(line) };
  };

  // What a version was: the snapshot of its tag; the current one, which a line older than the history has no tag for, from what the
  // line is now.
  #snapshotOf = async ({ line, token, projectId, userId, version }) => {
    const kept = await readLineVersion({ token, projectId, version, host: hostOf(line) });
    if (kept) return kept;
    if (version !== line.version) return null;
    const file = await this.getFeatureModel({ id: String(line._id), userId }).catch(() => null);
    if (!file) return null;
    let modules = null;
    let packages = null;
    if (line.modular) {
      const info = await this.modularService.getLineModules({ id: String(line._id), userId }).catch(() => null);
      modules = info?.spl?.modules ?? null;
      packages = info?.packages ? packagesOf(info.packages) : null;
    }
    return {
      version, savedAt: null, modular: Boolean(line.modular),
      featureModel: { type: 'UVL', content: file.uvl },
      modules,
      packages,
    };
  };

  /** The versions of a line, newest first: `{ current, versions: [{ version, savedAt, kept, modular, modules, current }] }`. */
  listVersions = async ({ id, userId }) => {
    const { line, token, projectId, host } = await this.#versionContext({ id, userId });
    const names = await listLineVersionNames({ token, projectId, host });
    const rows = await Promise.all(names.map(async (version) => {
      const snapshot = await readLineVersion({ token, projectId, version, host });
      return {
        version,
        savedAt: snapshot?.savedAt ?? null,
        kept: Boolean(snapshot),
        modular: Boolean(snapshot?.modular),
        modules: snapshot?.modules ? Object.keys(snapshot.modules).length : null,
        current: version === line.version,
      };
    }));
    if (!rows.some((row) => row.version === line.version)) {
      rows.unshift({ version: line.version, savedAt: null, kept: false, modular: Boolean(line.modular), modules: null, current: true });
    }
    rows.sort((a, b) => compareVersions(b.version, a.version));
    return { current: line.version, versions: rows };
  };

  /**
   * One version with what it was, and the one before it to see what it changed. `previous` is the version the history knows to be
   * the one before; without it the closest lower one is looked for.
   */
  getVersion = async ({ id, userId, version, previous: hinted }) => {
    if (!isVersion(version)) throw new NoDeployedSnapshotError();
    const { line, token, projectId, host } = await this.#versionContext({ id, userId });
    const snapshot = await this.#snapshotOf({ line, token, projectId, userId, version });
    if (!snapshot) throw new NoDeployedSnapshotError();

    let before = null;
    if (isVersion(hinted) && compareVersions(hinted, version) < 0) {
      before = await this.#snapshotOf({ line, token, projectId, userId, version: hinted });
    }
    if (!before) {
      const lower = (await listLineVersionNames({ token, projectId, host })).filter((v) => compareVersions(v, version) < 0)[0] ?? null;
      before = lower ? await this.#snapshotOf({ line, token, projectId, userId, version: lower }) : null;
    }
    const view = (s) => ({
      version: s.version, savedAt: s.savedAt ?? null, modular: Boolean(s.modular),
      featureModel: s.featureModel ?? null, modules: s.modules ?? null, packages: s.packages ?? null,
    });
    return { ...view(snapshot), previous: before ? view(before) : null };
  };
}

Container.set(LineService, new LineService());
