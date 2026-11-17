import { Container } from 'typedi';
import LineRepository from '../repositories/LineRepository.js';
import PermissionChecker from './PermissionChecker.js';
import { getGitProvider } from '../git/index.js';
import { hostOf, tokenFor } from '../git/hosts.js';
import { properties } from '../connectors/properties.js';
import { LineNotFoundError } from '../errors/errors.js';
import { ACCESS } from '@lbdudc/linea-git';
import {
  SPL_CI_CONFIG_PATH, SPL_CI_FILE_PATH, normalizeSplCi, parseSplCi, renderSplPipeline, serializeSplCi,
} from './ci/splPipeline.js';

const isNotFound = (error) => error?.status === 404 || /not found|404|there is no file/i.test(String(error?.message ?? ''));
const decode = (file) => Buffer.from(file.content, 'base64').toString('utf8');

/**
 * The CI of the repository of an SPL: its settings live in the repository (`.linea/ci.json`) and the pipeline file is rendered from them
 * and committed with them, in one commit to the default branch. Only GitLab runs it.
 */
export default class LineCiService {
  lineRepository = Container.get(LineRepository);
  permissionChecker = Container.get(PermissionChecker);

  #access = async ({ id, userId, accessLevel = ACCESS.REPORTER }) => {
    const line = await this.lineRepository.findById(id);
    if (!line) throw new LineNotFoundError();
    const host = hostOf(line);
    const git = getGitProvider({ host });
    const user = await this.permissionChecker.checkUserExistsAndHasPrivileges({ userId, repoId: line.repoId, accessLevel }, git);
    return { line, git, host, token: tokenFor(user, host), projectId: line.repoId };
  };

  #read = (git, token, projectId, path) => git.getFileRevision({ token, id: projectId, path, ref: properties.git.defaultBranch })
    .catch((error) => { if (isNotFound(error)) return null; throw error; });

  getCi = async ({ id, userId }) => {
    const { git, host, token, projectId } = await this.#access({ id, userId });
    const [canEdit, file, pipeline] = await Promise.all([
      this.permissionChecker.hasPrivileges({ userId, repoId: projectId, accessLevel: ACCESS.MAINTAINER }, git),
      this.#read(git, token, projectId, SPL_CI_CONFIG_PATH),
      this.#read(git, token, projectId, SPL_CI_FILE_PATH),
    ]);
    const config = parseSplCi(file ? decode(file) : null);
    return {
      host,
      canEdit,
      supported: host === 'gitlab',
      config,
      rendered: renderSplPipeline({ ...config, enabled: true }),
      pipelineFile: SPL_CI_FILE_PATH,
      fileInRepository: Boolean(pipeline),
    };
  };

  saveCi = async ({ id, userId, config }) => {
    const { git, token, projectId } = await this.#access({ id, userId, accessLevel: ACCESS.MAINTAINER });
    const next = normalizeSplCi(config);
    const [current, pipeline] = await Promise.all([
      this.#read(git, token, projectId, SPL_CI_CONFIG_PATH),
      this.#read(git, token, projectId, SPL_CI_FILE_PATH),
    ]);
    const settings = serializeSplCi(next);
    const file = renderSplPipeline(next);
    const actions = [];
    if (!current || decode(current) !== settings) {
      actions.push(current ? { action: 'update', path: SPL_CI_CONFIG_PATH, content: settings, expectedRevision: current.revision } : { action: 'create', path: SPL_CI_CONFIG_PATH, content: settings });
    }
    if (file !== null && (!pipeline || decode(pipeline) !== file)) {
      actions.push(pipeline ? { action: 'update', path: SPL_CI_FILE_PATH, content: file, expectedRevision: pipeline.revision } : { action: 'create', path: SPL_CI_FILE_PATH, content: file });
    }
    // CI off: no pipeline file (the settings stay, so turning it on again brings back the same checks)
    if (file === null && pipeline) actions.push({ action: 'delete', path: SPL_CI_FILE_PATH });
    // A repository made with CI/CD off would take the file and never run it: turning the checks on turns that on too
    if (next.enabled) await git.enablePipelines?.({ token, id: projectId });
    if (actions.length) {
      await git.commit({ token, id: projectId, branch: properties.git.defaultBranch, message: 'Update CI configuration', track: false, actions });
    }
    return this.getCi({ id, userId });
  };
}

Container.set(LineCiService, new LineCiService());
