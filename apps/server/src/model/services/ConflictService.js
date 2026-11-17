import { Container } from 'typedi';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import ProductRepository from '../repositories/ProductRepository.js';
import PermissionChecker from './PermissionChecker.js';
import { getGitProvider } from '../git/index.js';
import { hostOf, tokenFor, usernameOn } from '../git/hosts.js';
import { properties } from '../connectors/properties.js';
import { ACCESS } from '@lbdudc/linea-git';
import { removeWorkDir } from './workDirs.js';
import { ProductNotFoundError, RepositoryAccessError } from '../errors/errors.js';

const run = promisify(execFile);
const IDENTITY = ['-c', 'user.name=LINEA', '-c', 'user.email=linea@localhost'];
const STRATEGIES = ['main', 'generated', 'custom'];
// `.linea/` is LINEA's own record of the product (its spec, what is deployed): it lives on the product's branch and is never a
// decision for the person, so it is settled with the product's version without asking
const OWN_FILES = /^\.linea\//;

// The user name git is given with the token: each host has its own convention (GitLab accepts any name with an OAuth token but
// documents `oauth2`, GitHub wants `x-access-token`), and a local host only opens a repository to the account the token is of.
export const gitUsernameOn = (user, host) => {
  if (host === 'github') return 'x-access-token';
  if (host === 'local') return usernameOn(user, host);
  return 'oauth2';
};

// what git says never carries the token it was given in the address
const redact = (text, token) => String(text ?? '').split(token).join('***');

const failure = (message, status) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

/**
 * Resolving the conflicts of a merge request of a product, as the git host's own page does: the target branch is merged into the
 * branch of the request (the generated one), each conflicting file is settled, and the request can then be merged.
 *
 * The side called `generated` is the request's source branch (what LINEA derived); `main` is the product's own branch, with whatever
 * was edited there by hand.
 */
export default class ConflictService {
  productRepository = Container.get(ProductRepository);
  permissionChecker = Container.get(PermissionChecker);

  #context = async ({ id, userId, accessLevel }) => {
    const product = await this.productRepository.findById(id);
    if (!product) throw new ProductNotFoundError();
    const git = getGitProvider({ host: hostOf(product) });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: product.repo.id, accessLevel }, git);
    const host = hostOf(product);
    return { product, token: tokenFor(user, host), username: gitUsernameOn(user, host), git };
  };

  // the open requests into the product's own branch that cannot be merged as they are
  #conflictingRequests = async ({ git, token, product }) => {
    const requests = await git.listChangeRequests({
      token, id: product.repo.id, state: 'opened', targetBranch: properties.git.defaultBranch,
    });
    return requests.filter((request) => request.hasConflicts);
  };

  #cloneUrl = ({ product, token, username }) => {
    const url = new URL(product.repo.webUrl);
    url.username = username;
    url.password = token;
    return `${url.toString().replace(/\/+$/, '')}.git`;
  };

  // Clones the product, puts the request's source branch under the work tree and tries to merge the target into it. Calls `work`
  // with the places things are, and always removes the clone.
  #withMerge = async ({ product, token, username, request, work }) => {
    const dir = path.resolve(path.join(properties.paths.output, `conflicts-${uuidv4()}`));
    const git = async (args, options = {}) => {
      const { allowFailure, ...execOptions } = options;
      try {
        return await run('git', args, {
          cwd: dir, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, ...execOptions,
        });
      } catch (error) {
        if (allowFailure) return { stdout: error.stdout ?? '', stderr: error.stderr ?? '', failed: true };
        throw new Error(redact(error.stderr || error.message, token));
      }
    };
    try {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      try {
        await git(['clone', '--quiet', '--no-tags', this.#cloneUrl({ product, token, username }), dir], { cwd: path.dirname(dir) });
      } catch (error) {
        // not an "internal error": the person is told the repository could not be opened, and why
        throw new RepositoryAccessError(error.message, { cause: error });
      }
      await git(['checkout', '--quiet', '-B', 'linea-resolve', `origin/${request.sourceBranch}`]);
      await git([...IDENTITY, 'merge', '--no-commit', '--no-ff', `origin/${request.targetBranch}`], { allowFailure: true });
      const listed = await git(['diff', '--name-only', '--diff-filter=U']);
      const conflicted = listed.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
      return await work({ dir, git, conflicted });
    } finally {
      removeWorkDir(dir);
    }
  };

  // a side of a conflicted file (stage 2: the generated one, 3: main), `null` when that side has no such file
  #side = async (git, stage, file) => {
    const answer = await git(['show', `:${stage}:${file}`], { allowFailure: true, encoding: 'buffer' });
    return answer.failed ? null : answer.stdout;
  };

  /** The open requests of the product that have conflicts, with the files in conflict and both sides of each. */
  getConflicts = async ({ id, userId }) => {
    const { product, token, username, git } = await this.#context({ id, userId, accessLevel: ACCESS.DEVELOPER });
    const requests = await this.#conflictingRequests({ git, token, product });
    const answer = [];
    for (const request of requests) {
      const files = await this.#withMerge({
        product, token, username, request,
        work: async ({ git: sh, conflicted }) => {
          const found = [];
          for (const file of conflicted.filter((candidate) => !OWN_FILES.test(candidate))) {
            const generated = await this.#side(sh, 2, file);
            const main = await this.#side(sh, 3, file);
            const binary = [generated, main].some((buffer) => buffer && buffer.includes(0));
            found.push({
              path: file,
              binary,
              generated: binary || generated === null ? null : generated.toString('utf8'),
              main: binary || main === null ? null : main.toString('utf8'),
              generatedMissing: generated === null,
              mainMissing: main === null,
            });
          }
          return found;
        },
      });
      answer.push({
        number: request.number,
        title: request.title,
        webUrl: request.webUrl,
        sourceBranch: request.sourceBranch,
        targetBranch: request.targetBranch,
        files,
      });
    }
    return { requests: answer };
  };

  /**
   * Settles every conflicting file of one request, commits that to the request's source branch and merges the request.
   * `resolutions`: file path -> { strategy: 'main' | 'generated' | 'custom', content? }.
   */
  resolveConflicts = async ({ id, userId, number, resolutions }) => {
    const { product, token, username, git } = await this.#context({ id, userId, accessLevel: ACCESS.DEVELOPER });
    const request = (await this.#conflictingRequests({ git, token, product })).find((candidate) => candidate.number === Number(number));
    if (!request) throw failure('That merge request has no conflicts any more.', 409);
    const chosen = resolutions && typeof resolutions === 'object' ? resolutions : {};

    await this.#withMerge({
      product, token, username, request,
      work: async ({ dir, git: sh, conflicted }) => {
        for (const file of conflicted) {
          const choice = OWN_FILES.test(file) ? { strategy: 'main' } : chosen[file];
          if (!choice || !STRATEGIES.includes(choice.strategy)) throw failure(`There is no way chosen for ${file}.`, 400);
          const target = path.join(dir, file);
          if (choice.strategy === 'custom') {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, String(choice.content ?? ''), 'utf8');
            await sh(['add', '--', file]);
            continue;
          }
          const content = await this.#side(sh, choice.strategy === 'main' ? 3 : 2, file);
          if (content === null) {
            await sh(['rm', '--quiet', '--force', '--', file]);
          } else {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content);
            await sh(['add', '--', file]);
          }
        }
        const plural = conflicted.length === 1 ? '' : 's';
        await sh([...IDENTITY, 'commit', '--quiet', '-m', `Resolve the conflicts with ${request.targetBranch} (${conflicted.length} file${plural})`]);
        await sh(['push', '--quiet', 'origin', `linea-resolve:${request.sourceBranch}`]);
      },
    });

    // the host takes a moment to see the new commit
    let hasConflicts = true;
    for (let attempt = 0; attempt < 6 && hasConflicts; attempt += 1) {
      hasConflicts = await git.mergeChangeRequest({
        token, id: product.repo.id, number: request.number, deleteSourceBranch: false,
      });
      if (hasConflicts) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return { merged: !hasConflicts, number: request.number };
  };
}

Container.set(ConflictService, new ConflictService());
