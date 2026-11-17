import { Container } from 'typedi';
import LineRepository from '../repositories/LineRepository.js';
import ProductRepository from '../repositories/ProductRepository.js';
import { enabledHosts, primaryHost } from '../git/index.js';
import { LineNotFoundError, ProductNotFoundError, UserNotFoundError } from '../errors/errors.js';
import UserRepository from '../repositories/UserRepository.js';
import { activeHostOf } from '../git/hosts.js';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

// (a repository id on a host is a whole number; anything else is not one)
const asId = (id) => (/^\d+$/.test(String(id)) ? Number(id) : null);

/**
 * The line or product that owns a repository, and the repository's id on its host: by the line's or product's id (`kind` line |
 * product) or by the repository's own (`kind` repo, with `host`, else the primary one: ids are only unique on a host).
 */
export const ownerOfRepository = async ({ kind, id, host, userId }) => {
  if (kind === 'package') {
    const user = await Container.get(UserRepository).findById(userId);
    if (!user) throw new UserNotFoundError();
    return { owner: { gitHost: activeHostOf(user) }, projectId: asId(id) };
  }
  const lines = Container.get(LineRepository);
  const products = Container.get(ProductRepository);
  if ((kind === 'line' || kind === 'product') && !OBJECT_ID.test(String(id))) throw new (kind === 'line' ? LineNotFoundError : ProductNotFoundError)();
  if (kind === 'line') {
    const line = await lines.findById(id);
    if (!line) throw new LineNotFoundError();
    return { owner: line, projectId: line.repoId };
  }
  if (kind === 'product') {
    const product = await products.findById(id);
    if (!product) throw new ProductNotFoundError();
    return { owner: product, projectId: product.repo.id };
  }
  if (asId(id) === null) throw new LineNotFoundError();
  // ids are only unique on a host: the one named, else the primary one, else (a deployment with more) the others in turn
  const hosts = host ? [host] : [primaryHost(), ...enabledHosts().filter((h) => h !== primaryHost())];
  for (const on of hosts) {
    const product = await products.findByRepoId(asId(id), undefined, on);
    if (product) return { owner: product, projectId: product.repo.id };
    const line = await lines.findByRepoId(asId(id), undefined, on);
    if (line) return { owner: line, projectId: line.repoId };
  }
  throw new LineNotFoundError();
};
