import { Container } from 'typedi';
import Product from '../entities/product.js';
import Line from '../entities/line.js';
import SyncRun from '../entities/syncRun.js';
import ProductRepository from '../repositories/ProductRepository.js';
import LineRepository from '../repositories/LineRepository.js';
import PermissionChecker from './PermissionChecker.js';
import ProductCiService from './ProductCiService.js';
import { getGitProvider } from '../git/index.js';
import { hostOf } from '../git/hosts.js';
import { ProductNotFoundError, LineNotFoundError, assertLineAlive, isLineDeleted } from '../errors/errors.js';
import { effectiveSync, nextSyncFor } from './scheduler/schedule.js';
import { mapLimit } from './recent.js';
import { ACCESS } from '@lbdudc/linea-git';

const SYNC_PRODUCT = ['mode', 'preset', 'cron', 'behavior'];
const SYNC_LINE = ['enabled', 'preset', 'cron', 'behavior'];
const GENERATION = ['bump', 'autoMerge'];
const pick = (source = {}, keys) => Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
const dotted = (prefix, values) => Object.fromEntries(Object.entries(values).map(([key, value]) => [`${prefix}.${key}`, value]));
const plain = (doc) => JSON.parse(JSON.stringify(doc ?? {}));

/**
 * What a product and its line say about syncing and generating: the schedule and behavior of the sync (the line's are the defaults the
 * products inherit) and what a generation does by default. Kept in Mongo, not in the repository: it is how LINEA treats the product, not
 * part of what is generated.
 */
export default class AutomationService {
  productRepository = Container.get(ProductRepository);
  lineRepository = Container.get(LineRepository);
  permissionChecker = Container.get(PermissionChecker);
  productCiService = Container.get(ProductCiService);

  async #product(id, userId, accessLevel) {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const line = await this.lineRepository.findById(product.lineId);
    await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel }, getGitProvider({ host: hostOf(product) }));
    return { product, line };
  }

  async #line(id, userId, accessLevel) {
    const line = await this.lineRepository.findById(id);
    if (!line) throw new LineNotFoundError();
    await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: line.repoId, accessLevel }, getGitProvider({ host: hostOf(line) }));
    return line;
  }

  /** Throws unless the person may see the product / the line (reporter access). */
  assertProductAccess = async ({ id, userId }) => { await this.#product(id, userId, ACCESS.REPORTER); };
  assertLineAccess = async ({ id, userId }) => { await this.#line(id, userId, ACCESS.REPORTER); };

  #canEdit = (userId, repoId, owner) => this.permissionChecker.hasPrivileges({ userId, repoId, accessLevel: ACCESS.MAINTAINER }, getGitProvider({ host: hostOf(owner) }));

  async #describeProduct(product, line, userId) {
    return {
      canEdit: !isLineDeleted(line) && await this.#canEdit(userId, product.repo.id, product),
      sync: plain(product.sync),
      generation: plain(product.generation),
      // what applies, and from where: the screen shows "inherited from the SPL" without working it out
      effective: effectiveSync(product, line),
      lineSync: plain(line.sync),
      lastSyncAt: product.lastSyncAt,
      nextSyncAt: product.nextSyncAt,
    };
  }

  getProductAutomation = async ({ id, userId }) => {
    const { product, line } = await this.#product(id, userId, ACCESS.REPORTER);
    return this.#describeProduct(product, line, userId);
  };

  saveProductAutomation = async ({ id, userId, sync, generation }) => {
    const { line } = await this.#product(id, userId, ACCESS.MAINTAINER);
    assertLineAlive(line);
    const set = { ...dotted('sync', pick(sync, SYNC_PRODUCT)), ...dotted('generation', pick(generation, GENERATION)) };
    const product = await Product.findByIdAndUpdate(id, { $set: set }, { new: true });
    // the schedule may have changed: the next time counts from now
    product.nextSyncAt = nextSyncFor(product, line);
    await Product.updateOne({ _id: id }, { $set: { nextSyncAt: product.nextSyncAt } });
    return this.#describeProduct(product, line, userId);
  };

  getLineSync = async ({ id, userId }) => {
    const line = await this.#line(id, userId, ACCESS.REPORTER);
    const products = await Product.find({ lineId: id, archived: { $ne: true } }).select('sync').lean();
    return {
      canEdit: await this.#canEdit(userId, line.repoId, line),
      sync: plain(line.sync),
      products: {
        total: products.length,
        own: products.filter((product) => product.sync?.mode === 'custom').length,
        off: products.filter((product) => product.sync?.mode === 'off').length,
      },
    };
  };

  saveLineSync = async ({ id, userId, sync }) => {
    await this.#line(id, userId, ACCESS.MAINTAINER);
    const line = await Line.findByIdAndUpdate(id, { $set: dotted('sync', pick(sync, SYNC_LINE)) }, { new: true });
    // the products that follow the line get a time that fits the new schedule
    const products = await Product.find({ lineId: id, archived: { $ne: true }, 'sync.mode': { $nin: ['custom', 'off'] } });
    await Promise.all(products.map((product) => Product.updateOne({ _id: product._id }, { $set: { nextSyncAt: nextSyncFor(product, line) } })));
    return this.getLineSync({ id, userId });
  };

  /** The syncs of every product of a line, newest first (the line's CI/CD view). */
  listLineSyncs = async ({ id, userId, limit = 100 }) => {
    await this.#line(id, userId, ACCESS.REPORTER);
    const runs = await SyncRun.find({ lineId: id }).sort({ startedAt: -1 }).limit(Math.min(Number(limit) || 100, 300)).lean();
    const names = new Map((await Product.find({ lineId: id }).select('spec.basicData.name').lean()).map((product) => [String(product._id), product.spec?.basicData?.name]));
    return runs.map((run) => ({ ...run, product: names.get(String(run.productId)) }));
  };

  /** The merge requests of all the products of a line, each tagged with its product and what opened it (`sync` | `generation`). */
  listLineMergeRequests = async ({ id, userId }) => {
    await this.#line(id, userId, ACCESS.REPORTER);
    const products = await Product.find({ lineId: id, archived: { $ne: true } }).select('spec.basicData.name').lean();
    const perProduct = await mapLimit(products, 4, async (product) => {
      const requests = await this.productCiService.listMergeRequests({ id: String(product._id), userId }).catch(() => []);
      return requests.map((request) => ({ ...request, productId: String(product._id), product: product.spec?.basicData?.name }));
    });
    return perProduct.flat().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  };
}

Container.set(AutomationService, new AutomationService());
