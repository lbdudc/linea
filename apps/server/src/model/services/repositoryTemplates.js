const TTL_MS = 60_000;
const cache = new Map();

export const templatesOf = async ({ git, token, projectId, host, kind }) => {
  if (git.capabilities().templates.editable) return git.listTemplates({ token, id: projectId, kind }).catch(() => []);
  const key = `${host}:${projectId}:${kind}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.templates;
  const templates = await git.listTemplates({ token, id: projectId, kind }).catch(() => []);
  cache.set(key, { templates, expiresAt: Date.now() + TTL_MS });
  return templates;
};

export const forgetTemplates = () => cache.clear();
