// Lines, products and users were named after GitLab, the only git host there was: their fields say what they are on any host now.
//   line:    gitlabProjectId -> repoId, gitlabNamespaceId -> namespaceId, gitlabWebUrl -> webUrl, gitlabWebIdeUrl -> webIdeUrl
//   product: gitlab { projectId, namespaceId, webUrl, webIdeUrl } -> repo { id, namespaceId, webUrl, webIdeUrl }, specInGitlab -> specInRepo
//   user:    gitlabAccessToken -> accessToken, gitlabRefreshToken -> refreshToken
// The git hosts were plugins' (gitlab-plugin, github-plugin) and so were the line kinds (modular-plugin): what an administrator saved for
// a host plugin becomes the host's own settings, and the records of the three plugins go.

import { HOST_SCHEMAS } from '../../config/gitHostSchemas.js';

const HOST_OF_PLUGIN = { 'gitlab-plugin': 'gitlab', 'github-plugin': 'github' };
const REMOVED_PLUGINS = ['modular-plugin', 'gitlab-plugin', 'github-plugin'];

// A field moves to its new name; where both exist (the migration ran halfway, or the new one was written already) the new one stays
const renameField = async (collection, from, to) => {
  await collection.updateMany({ [from]: { $exists: true }, [to]: { $exists: false } }, { $rename: { [from]: to } });
  await collection.updateMany({ [from]: { $exists: true } }, { $unset: { [from]: '' } });
};

export default async (db) => {
  const lines = db.collection('lines');
  for (const [from, to] of [['gitlabProjectId', 'repoId'], ['gitlabNamespaceId', 'namespaceId'], ['gitlabWebUrl', 'webUrl'], ['gitlabWebIdeUrl', 'webIdeUrl']]) {
    await renameField(lines, from, to);
  }

  const products = db.collection('products');
  await renameField(products, 'gitlab', 'repo');
  await renameField(products, 'repo.projectId', 'repo.id');
  await renameField(products, 'specInGitlab', 'specInRepo');

  const users = db.collection('users');
  await renameField(users, 'gitlabAccessToken', 'accessToken');
  await renameField(users, 'gitlabRefreshToken', 'refreshToken');

  const hostSettings = db.collection('githostsettings');
  const plugins = db.collection('plugins');
  for (const record of await plugins.find({ id: { $in: Object.keys(HOST_OF_PLUGIN) } }).toArray()) {
    const host = HOST_OF_PLUGIN[record.id];
    // only what the host knows is kept (a key from the plugin's own manifest that the host has no use for is said, not carried)
    const known = Object.fromEntries(Object.entries(record.settings ?? {}).filter(([key]) => key in HOST_SCHEMAS[host]));
    for (const key of Object.keys(record.settings ?? {})) if (!(key in known)) console.warn(`[migrations] ${record.id}: the setting "${key}" is not one of the ${host} host, left out`);
    // a plugin that was never installed said nothing about the host: leave it to the environment; an existing record of the host
    // (the migration ran halfway) is not overwritten
    await hostSettings.updateOne(
      { host },
      { $setOnInsert: { host, ...(record.installed ? { enabled: Boolean(record.enabled) } : {}), settings: known } },
      { upsert: true },
    );
  }
  // the records go, but a copy stays in case this has to be undone by hand
  const removed = await plugins.find({ id: { $in: REMOVED_PLUGINS } }).toArray();
  if (removed.length) {
    await db.collection('plugins_backup').insertMany(removed.map(({ _id, ...record }) => ({ ...record, removedAt: new Date() })));
    await plugins.deleteMany({ id: { $in: REMOVED_PLUGINS } });
  }
};
