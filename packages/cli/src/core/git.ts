import { createRoutingSource, type PackageCatalog, type PackageSource } from '@lbdudc/linea-core';
import {
  createGitCatalog,
  createGitProvider,
  createPackageSource,
  gitConfigFromEnv,
  listPackages,
  listRegisteredPackages,
  type GitConfig,
  type GitProvider,
  type PackageKind,
  type PackageSummary,
} from '@lbdudc/linea-git';
import { storedGit, type StoredGit } from './credentials.js';

/**
 * The CLI talks to a git host (GitLab or GitHub) through `@lbdudc/linea-git`, the same library the LINEA server uses, so a package
 * can be listed, published and used from a terminal without the server in the way. The host is told as the server is told it:
 *
 *   GIT_PROVIDER=gitlab|github
 *   GitLab:  GITLAB_HOSTNAME (and GITLAB_TOKEN)        GitHub:  GITHUB_URL / GITHUB_API_URL if not github.com (and GITHUB_TOKEN)
 *   LINEA_GIT_TOKEN  a token for either (it wins over the two above)
 *   LINEA_TRUSTED_NAMESPACES  where packages may come from (they carry scripts that run here)
 *   LINEA_REGISTRY  the repository that holds the catalog of registered packages (`gitlab:linea/registry`); with it, `list --remote`
 *                   shows what is registered there instead of every repository that has the topic
 */

export interface GitSettings {
  config: GitConfig;
  token: string;
  /** where the token comes from: the environment, what LINEA's server gave, or a personal access token the user gave */
  source: 'environment' | 'server' | 'token';
  /** the name to give git with the token, when the user chose one (`login --username`) */
  username?: string;
}

type Env = Record<string, string | undefined>;

/** What a host is called to the person. */
export const hostLabel = (provider: string | undefined): string => (provider === 'github' ? 'GitHub' : provider === 'local' ? 'LINEA' : 'GitLab');

/** The token of the user for the host: what to say to it. `undefined` when none is set. */
export function gitToken(config: GitConfig, env: Env = process.env): string | undefined {
  return env['LINEA_GIT_TOKEN'] ?? (config.provider === 'github' ? env['GITHUB_TOKEN'] : env['GITLAB_TOKEN']);
}

/** The host the stored credentials are for, as settings (the rest of the configuration still comes from the environment). */
export function gitConfigOf(stored: StoredGit, env: Env = process.env): GitConfig {
  return gitConfigFromEnv({
    REDIRECT_URI: 'http://127.0.0.1',
    ...env,
    GIT_PROVIDER: stored.provider,
    // the repositories of a LINEA that keeps them itself are served by its server, under /git
    ...(stored.provider === 'local' && stored.host.url ? { LINEA_GIT_URL: stored.host.url } : {}),
    ...(stored.host.url ? { GITLAB_HOSTNAME: stored.host.url } : {}),
    ...(stored.host.webUrl ? { GITHUB_URL: stored.host.webUrl } : {}),
    ...(stored.host.apiUrl ? { GITHUB_API_URL: stored.host.apiUrl } : {}),
  });
}

/**
 * The host and the token, or an error that says what is missing. A token in the environment wins; without one, what the LINEA server
 * gave at `login` is used, so signing in once is enough.
 */
export function gitSettings(env: Env = process.env, stored: StoredGit | undefined = storedGit()): GitSettings {
  const config = gitConfigFromEnv({ REDIRECT_URI: 'http://127.0.0.1', ...env });
  const token = gitToken(config, env);
  // (on the local host the name is the account's: git asks for it with the token as the password)
  if (!token && stored?.token) return { config: gitConfigOf(stored, env), token: stored.token, source: stored.source, ...((stored.source === 'token' || stored.provider === 'local') && stored.username ? { username: stored.username } : {}) };
  const host = hostLabel(config.provider);
  if (config.provider === 'gitlab' && !config.gitlab?.url) {
    throw new Error('GitLab is the git host but its address is not set: export GITLAB_HOSTNAME=https://… (or GIT_PROVIDER=github).');
  }
  if (!token) {
    throw new Error(
      `No ${host} token: export ${config.provider === 'github' ? 'GITHUB_TOKEN' : 'GITLAB_TOKEN'}=… (or LINEA_GIT_TOKEN) with the rights to ${config.provider === 'github' ? '`repo`' : '`api`'}, or: login --token <token or file>`,
    );
  }
  return { config, token, source: 'environment' };
}

/** What the CLI cannot do against a LINEA that keeps its repositories itself: the library reads them on the server's disk, not over the network. */
export const LOCAL_HOST_LIMIT =
  "This LINEA keeps its repositories itself: get, push and clone work (they use git over HTTP), but the CLI cannot list packages or the registry from the host. Use the web app for those.";

export function gitProviderOf(settings: GitSettings = gitSettings()): GitProvider {
  if (settings.config.provider === 'local') throw new Error(LOCAL_HOST_LIMIT);
  return createGitProvider(settings.config);
}

/** The catalog of registered packages, or `undefined` when no `LINEA_REGISTRY` says where it is. */
export function catalogOf(settings: GitSettings = gitSettings()): PackageCatalog | undefined {
  const location = settings.config.registry;
  return location ? createGitCatalog({ provider: gitProviderOf(settings), token: settings.token, location }) : undefined;
}

/** The packages of one kind on the git host: the registered ones when there is a registry, otherwise every one that has the topic. */
export async function remotePackages({ settings, kind }: { settings: GitSettings; kind: PackageKind }): Promise<PackageSummary[]> {
  const provider = gitProviderOf(settings);
  const catalog = catalogOf(settings);
  if (catalog) {
    return listRegisteredPackages({ provider, token: settings.token, kind, catalog, source: createPackageSource(settings.config, { token: settings.token, userId: 'cli' }) });
  }
  return listPackages({ provider, token: settings.token, kind, config: settings.config, userId: 'cli' });
}

/**
 * Where a local SPL reads its packages from: the folders of the workspace (`file:modules/x`) and, when a git host is set up, the
 * host's repositories (`gitlab:group/project`, `github:owner/repo`). Without a host only the workspace is read.
 */
export function packageSourceOf(fsSource: PackageSource, env: Env = process.env, stored?: StoredGit): PackageSource {
  let settings: GitSettings;
  try {
    settings = gitSettings(env, stored ?? storedGit());
  } catch {
    return fsSource;
  }
  if (settings.config.provider === 'local') return fsSource;
  const remote = createPackageSource(settings.config, { token: settings.token, userId: 'cli' });
  return createRoutingSource({ sources: { file: fsSource, gitlab: remote, github: remote } });
}
