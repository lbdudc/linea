import Line from '../entities/line.js';
import Product from '../entities/product.js';
import User from '../entities/user.js';
import { onHost } from './hosts.js';

/** How many users, lines and products name no host (migration 3 gives every one a host: this should be zero). */
export const unpinnedCount = async () => {
  const nameless = { $or: [{ gitHost: { $exists: false } }, { gitHost: null }, { gitHost: '' }] };
  return (await Promise.all([User, Line, Product].map((model) => model.countDocuments(nameless)))).reduce((a, b) => a + b, 0);
};

/** What lives on a git host: `{ lines, products, users, admins, total }`, to warn before it is switched off. */
export const usageOfHost = async (host) => {
  const [lines, products, users, admins] = await Promise.all([
    Line.countDocuments(onHost(host)),
    Product.countDocuments(onHost(host)),
    User.countDocuments({ $or: [onHost(host), { 'identities.host': host }] }),
    User.countDocuments({ admin: true, ...onHost(host) }),
  ]);
  return { lines, products, users, admins, total: lines + products + users };
};
