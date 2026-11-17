import AuditEntry from './entities/auditEntry.js';
import User from './entities/user.js';
import { instance } from '../config/instanceSettings.js';

/** Writes an entry. The audit log never makes what it records fail: a problem is logged and the request goes on. */
export const record = async ({ userId, action, target, detail, ip }) => {
  try {
    const user = userId ? await User.findById(userId).select('username').lean() : null;
    await AuditEntry.create({ actor: userId ? { id: String(userId), username: user?.username } : undefined, action, target, detail, ip });
  } catch (error) {
    console.error(`[audit] could not record ${action}:`, error.message);
  }
};

/**
 * Route middleware: once the answer is a success, `action` is recorded as done by the person asking. `target` and `detail` read the request
 * (never put a secret in them: a detail is stored as it is shown).
 */
export const audited = (action, { target, detail } = {}) => (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    record({ userId: req.userId, action, target: target?.(req), detail: detail?.(req), ip: req.ip });
  });
  next();
};

/** What a request body changes, as the names of its keys (a secret has no place in the log). */
export const keysOf = (body) => Object.keys(body ?? {}).filter((key) => key !== 'settings').concat(Object.keys(body?.settings ?? {}).map((key) => `settings.${key}`));

/** Newest first; `before` (an id) continues a listing. */
export const listAudit = async ({ limit = 50, before, action, actor } = {}) => {
  const query = {};
  if (before) query._id = { $lt: before };
  if (action) query.action = new RegExp(`^${String(action).replace(/[^\w.-]/g, '')}`);
  if (actor) query['actor.username'] = actor;
  const entries = await AuditEntry.find(query).sort({ _id: -1 }).limit(Math.min(Math.max(Number(limit) || 50, 1), 500)).lean();
  return entries.map(({ _id, at, actor: who, action: what, target, detail, ip }) => ({ id: String(_id), at, actor: who?.username ?? null, action: what, target, detail, ip }));
};

/** Forgets what is older than the retention an administrator chose. */
export const pruneAudit = async () => {
  const days = instance('auditRetentionDays');
  const { deletedCount } = await AuditEntry.deleteMany({ at: { $lt: new Date(Date.now() - days * 86_400_000) } });
  return deletedCount;
};
