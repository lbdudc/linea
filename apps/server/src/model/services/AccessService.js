import { Container } from 'typedi';
import { ACCESS } from '@lbdudc/linea-git';
import Line from '../entities/line.js';
import Product from '../entities/product.js';
import User from '../entities/user.js';
import LineRepository from '../repositories/LineRepository.js';
import ProductRepository from '../repositories/ProductRepository.js';
import UserRepository from '../repositories/UserRepository.js';
import PermissionChecker from './PermissionChecker.js';
import { LineNotFoundError, ProductNotFoundError, UserNotFoundError } from '../errors/errors.js';
import { getGitProvider, hostDescriptor } from '../git/index.js';
import { hostOf, tokenFor, usernameOn } from '../git/hosts.js';
import { record } from '../audit.js';

/** The levels LINEA gives, and who may give them: the local host has no owners but the one who made the repository. */
const LEVELS = [ACCESS.REPORTER, ACCESS.DEVELOPER, ACCESS.MAINTAINER, ACCESS.OWNER];

export class AccessLevelError extends Error {
  constructor(level) {
    super(`${level} is not a level of access`);
    this.code = 'ACCESS_LEVEL';
  }
}

/**
 * Who can reach the repositories of a line and its products on its git host, written to the host through `linea-git`. LINEA keeps a
 * record of what it gave (`Line.access`; `Product.access` for what one product does differently) and compares the host with it.
 */
export default class AccessService {
  lineRepository = Container.get(LineRepository);
  productRepository = Container.get(ProductRepository);
  userRepository = Container.get(UserRepository);
  permissionChecker = Container.get(PermissionChecker);

  /** Who may change access: the owner on the local host (it has no one else who can), a maintainer on the others. */
  #manageLevel = (host) => (hostDescriptor(host).managesMembers ? ACCESS.OWNER : ACCESS.MAINTAINER);

  async #lineContext({ id, userId, write = false }) {
    const line = await this.lineRepository.findById(id);
    if (!line) throw new LineNotFoundError();
    const host = hostOf(line);
    const git = getGitProvider({ host });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: line.repoId, accessLevel: write ? this.#manageLevel(host) : ACCESS.REPORTER }, git);
    return { line, host, git, user, token: tokenFor(user, host) };
  }

  async #productContext({ id, userId, write = false }) {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const line = await this.lineRepository.findById(product.lineId);
    if (!line) throw new LineNotFoundError();
    const host = hostOf(product);
    const git = getGitProvider({ host });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel: write ? this.#manageLevel(host) : ACCESS.REPORTER }, git);
    return { product, line, host, git, user, token: tokenFor(user, host) };
  }

  /** What a person may be given here. */
  levelsFor = (host) => LEVELS.filter((level) => level < ACCESS.OWNER || !hostDescriptor(host).managesMembers);

  #checkLevel(host, level) {
    if (!this.levelsFor(host).includes(Number(level))) throw new AccessLevelError(level);
    return Number(level);
  }

  /** What the host has against what LINEA recorded: `missing` (recorded and not there, or lower) and `unknown` (set on the repository, not recorded). */
  #drift({ entries, wanted, owner }) {
    const direct = new Map(entries.filter((entry) => entry.source === 'direct').map((entry) => [entry.username, entry.accessLevel]));
    const missing = wanted.filter((want) => (want.level > 0 ? (direct.get(want.username) ?? 0) !== want.level : direct.has(want.username)))
      .map((want) => ({ username: want.username, level: want.level, found: direct.get(want.username) ?? 0 }));
    const known = new Set(wanted.map((want) => want.username));
    const unknown = [...direct].filter(([username, level]) => !known.has(username) && username !== owner && level < ACCESS.OWNER)
      .map(([username, level]) => ({ username, level }));
    return { missing, unknown };
  }

  /** What a product should have: the line's record, with what the product does differently on top. */
  #wantedForProduct(line, product) {
    const byName = new Map((line.access ?? []).map((entry) => [entry.username, entry.level]));
    for (const entry of product.access ?? []) byName.set(entry.username, entry.level);
    return [...byName].map(([username, level]) => ({ username, level }));
  }

  async #view({ git, token, repoId, user, host, wanted, canManage }) {
    const entries = await git.listAccess({ token, id: repoId });
    const names = new Set(wanted.map((want) => want.username));
    const mine = await git.getAccessLevel({ token, id: repoId, username: usernameOn(user, host) });
    return {
      host,
      levels: this.levelsFor(host),
      myLevel: user.admin ? Math.max(mine, ACCESS.OWNER) : mine,
      canManage: canManage && mine >= this.#manageLevel(host) || Boolean(user.admin),
      entries: entries.map((entry) => ({ ...entry, managed: names.has(entry.username) })),
      drift: this.#drift({ entries, wanted, owner: null })
    };
  }

  /** Who has access to the line's repository, where it comes from and whether it is what LINEA recorded. */
  line = async ({ id, userId }) => {
    const { line, host, git, user, token } = await this.#lineContext({ id, userId });
    const wanted = (line.access ?? []).map(({ username, level }) => ({ username, level }));
    return { ...(await this.#view({ git, token, repoId: line.repoId, user, host, wanted, canManage: true })), record: wanted };
  };

  product = async ({ id, userId }) => {
    const { product, line, host, git, user, token } = await this.#productContext({ id, userId });
    const wanted = this.#wantedForProduct(line, product);
    const overrides = (product.access ?? []).map(({ username, level }) => ({ username, level }));
    return { ...(await this.#view({ git, token, repoId: product.repo.id, user, host, wanted, canManage: true })), record: wanted, overrides };
  };

  /** The products of a line, each with its repository: what a change to the line reaches. */
  async #productsOf(line) {
    return (await this.productRepository.findByLineId(line._id)).filter((product) => product.repo?.id != null);
  }

  /** Runs one write on each target and collects what failed, so a refusal on one repository does not leave the rest undone silently. */
  async #applyAll(targets, write) {
    const failures = [];
    for (const target of targets) {
      try {
        await write(target);
      } catch (error) {
        failures.push({ target: target.name, error: error?.message ?? String(error) });
      }
    }
    return failures;
  }

  async #changeLine({ id, userId, username, level, ip }) {
    const { line, host, git, token } = await this.#lineContext({ id, userId, write: true });
    const checked = level === 0 ? 0 : this.#checkLevel(host, level);
    const person = await this.#person({ host, git, token, username });
    const products = (await this.#productsOf(line)).filter((product) => !(product.access ?? []).some((entry) => entry.username === person));
    const targets = [{ name: line.name, repoId: line.repoId }, ...products.map((product) => ({ name: product.spec?.basicData?.name ?? String(product._id), repoId: product.repo.id }))];
    const failures = await this.#applyAll(targets, (target) => this.#write({ git, token, repoId: target.repoId, username: person, level: checked }));
    await Line.updateOne({ _id: line._id }, { $pull: { access: { username: person } } });
    if (checked > 0) await Line.updateOne({ _id: line._id }, { $push: { access: { username: person, level: checked } } });
    await record({ userId, action: checked ? 'access.set' : 'access.remove', target: `line:${line.name}`, detail: { username: person, level: checked, repositories: targets.length, failures }, ip });
    return { failures };
  }

  async #write({ git, token, repoId, username, level }) {
    if (level > 0) await git.setAccess({ token, id: repoId, username, accessLevel: level });
    else await git.removeAccess({ token, id: repoId, username });
  }

  /** The name the host knows a person by; on the local host, only people with an account here can be given access. */
  async #person({ host, git, token, username }) {
    const name = String(username ?? '').trim();
    if (!name) throw new UserNotFoundError();
    if (hostDescriptor(host).managesMembers) {
      const found = await this.userRepository.findByUsername(name);
      if (!found || (found.gitHost ?? host) !== host) throw new UserNotFoundError();
      return found.username;
    }
    const found = await git.searchUsers({ token, query: name });
    if (!found.some((user) => user.username === name)) throw new UserNotFoundError();
    return name;
  }

  /** Gives a person a level on the line's repository and on those of its products (except the products that treat them apart). */
  setLine = ({ id, userId, username, level, ip }) => this.#changeLine({ id, userId, username, level: Number(level), ip });

  removeLine = ({ id, userId, username, ip }) => this.#changeLine({ id, userId, username, level: 0, ip });

  /** A person's access to one product, apart from its line: `level` 0 closes the product to them. */
  setProduct = async ({ id, userId, username, level, ip }) => {
    const { product, line, host, git, token } = await this.#productContext({ id, userId, write: true });
    const checked = level === 0 ? 0 : this.#checkLevel(host, level);
    const person = await this.#person({ host, git, token, username });
    await this.#write({ git, token, repoId: product.repo.id, username: person, level: checked });
    await Product.updateOne({ _id: product._id }, { $pull: { access: { username: person } } });
    await Product.updateOne({ _id: product._id }, { $push: { access: { username: person, level: checked } } });
    await record({ userId, action: 'access.product.set', target: `product:${product.spec?.basicData?.name ?? product._id}`, detail: { line: line.name, username: person, level: checked }, ip });
  };

  /** The product goes back to what its line gives the person. */
  clearProduct = async ({ id, userId, username, ip }) => {
    const { product, line, git, token } = await this.#productContext({ id, userId, write: true });
    const level = (line.access ?? []).find((entry) => entry.username === username)?.level ?? 0;
    await this.#write({ git, token, repoId: product.repo.id, username, level });
    await Product.updateOne({ _id: product._id }, { $pull: { access: { username } } });
    await record({ userId, action: 'access.product.clear', target: `product:${product.spec?.basicData?.name ?? product._id}`, detail: { line: line.name, username, level }, ip });
  };

  /** Writes what LINEA recorded to the repositories again; `removeUnknown` also takes away what the host has that LINEA never gave. */
  reapply = async ({ id, userId, removeUnknown = false, ip }) => {
    const { line, git, token } = await this.#lineContext({ id, userId, write: true });
    const products = await this.#productsOf(line);
    const targets = [
      { name: line.name, repoId: line.repoId, wanted: (line.access ?? []).map(({ username, level }) => ({ username, level })) },
      ...products.map((product) => ({ name: product.spec?.basicData?.name ?? String(product._id), repoId: product.repo.id, wanted: this.#wantedForProduct(line, product) }))
    ];
    const failures = await this.#applyAll(targets, async (target) => {
      for (const want of target.wanted) await this.#write({ git, token, repoId: target.repoId, username: want.username, level: want.level });
      if (removeUnknown) {
        const entries = await git.listAccess({ token, id: target.repoId });
        const { unknown } = this.#drift({ entries, wanted: target.wanted, owner: null });
        for (const entry of unknown) await git.removeAccess({ token, id: target.repoId, username: entry.username });
      }
    });
    await record({ userId, action: 'access.reapply', target: `line:${line.name}`, detail: { repositories: targets.length, removeUnknown, failures }, ip });
    return { failures };
  };

  /** People of the line's host to give access to. */
  searchUsers = async ({ id, userId, query }) => {
    const { host, git, token } = await this.#lineContext({ id, userId });
    const needle = String(query ?? '').trim();
    if (needle.length < 2) return [];
    if (hostDescriptor(host).managesMembers) {
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const found = await User.find({ username: new RegExp(escaped, 'i') }).select('username avatarUrl gitHost').limit(10).lean();
      return found.filter((user) => (user.gitHost ?? host) === host).map((user) => ({ username: user.username, name: user.username, avatarUrl: user.avatarUrl ?? null }));
    }
    return git.searchUsers({ token, query: needle });
  };
}

Container.set(AccessService, new AccessService());
