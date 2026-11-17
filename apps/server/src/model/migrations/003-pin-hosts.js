import { PRIMARY_KEY, resolveGitHosts } from '../../config/gitHosts.js';

// What named no git host belonged to "the primary host", whichever that was at the moment: if an administrator switched hosts later, it
// moved to another with all of it. Now every user, line and product says its host, and the primary host is kept when there was data.

export default async (db, { declared = {}, env = process.env } = {}) => {
  const hostSettings = db.collection('githostsettings');
  const stored = Object.fromEntries((await hostSettings.find().toArray()).map(({ host, enabled, settings }) => [host, { enabled, settings }]));
  const primary = resolveGitHosts({ declared, stored, env }).primary;

  const nameless = { $or: [{ gitHost: { $exists: false } }, { gitHost: null }, { gitHost: '' }] };
  let changed = 0;
  for (const name of ['users', 'lines', 'products']) {
    changed += (await db.collection(name).updateMany(nameless, { $set: { gitHost: primary } })).modifiedCount;
  }
  if (changed > 0 && !declared.primary) {
    await hostSettings.updateOne({ host: PRIMARY_KEY }, { $setOnInsert: { host: PRIMARY_KEY, settings: { host: primary } } }, { upsert: true });
  }
};
