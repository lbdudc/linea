// A local account's git token used to be kept in the database as it was. It is made now (see git/localToken.js), so the copy goes: a copy
// of the database holds nothing that opens a repository. The tokens that were given out stop working; people ask for a new one by
// signing in (the web app, `linea login`), and the git credentials of the machines that had the old one are renewed the same way.
export default async (db) => {
  await db.collection('users').updateMany({ gitHost: 'local', accessToken: { $exists: true } }, { $set: { gitTokenVersion: 1 }, $unset: { accessToken: '' } });
};
