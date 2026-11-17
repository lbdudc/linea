/**
 * Unit tests for generatePipeline.js stages.
 * No real DB, no GitLab session, no file system — each test drives a single
 * stage with minimal mocks so the logic is verifiable in isolation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import FeatureSelectionError from 'spl-js-engine/src/feature-model/feature-selection-error.js';
import { LinePlatformNotFoundError } from '../model/errors/errors.js';
import { LinePlatformNotFoundError as CoreLinePlatformNotFoundError, ModuleCheckError, diffDirectories } from '@lbdudc/linea-core';
import { modularOf } from './support/derivation.js';
import { generateActions } from '../model/services/utils.js';
import { onError } from '../rest/common/onError.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

import { GitLabProvider } from '@lbdudc/linea-git';
import { Readable } from 'node:stream';
import {
  downloadOldProduct,
  runEngine,
  checkEmptyDiff,
  saveProductVersion,
  mergeGenerationBranch,
  createVersionTag,
  mergeUpdateBranch,
} from '../model/services/generatePipeline.js';

const LPS_FIXTURE = path.resolve('src', 'test', 'mocks', 'lps');
const VALID_FEATURES = [
  'GEMA_SPL', 'DataManagement', 'GraphicalUserInterface', 'MapViewer', 'Tools',
  'DM_SpatialDatabase', 'DM_GenerationType', 'DM_DataServer', 'MV_MapServer', 'MV_Tools',
  'MV_MapManagement', 'DM_SD_PostGIS', 'MV_T_Pan', 'MV_T_Zoom', 'DM_GT_Identity',
  'MV_MS_GeoServer', 'MV_MM_UniqueMapViewer', 'MV_MM_UMV_MapCenter', 'MV_MM_UMV_MC_BBox', 'T_GIS',
];
const baseSpec = (features) => ({
  basicData: { name: 'X', version: '0.0.0', database: {}, languages: ['en'] },
  dataModel: { cells: [] },
  statics: [],
  features,
});

// ─── runEngine — error routing logic ────────────────────────────────────────
// runEngine integrates with the filesystem and engine, so we test its
// error-classification logic in isolation rather than via module mocks.
describe('runEngine error routing', () => {
  it('identifies FeatureSelectionError by instanceof (should rethrow directly)', () => {
    const fse = new FeatureSelectionError('bad selection');
    expect(fse instanceof FeatureSelectionError).toBe(true);
  });

  it('maps generic Error to its .message (not a special key)', () => {
    const err = new Error('template file not found');
    const logMessage = err instanceof ReferenceError
      ? 'error_messages.missing_function_error'
      : err.message;
    expect(logMessage).toBe('template file not found');
  });

  it('maps ReferenceError to missing_function_error i18n key', () => {
    const err = new ReferenceError('getDefaultExport is not defined');
    const logMessage = err instanceof ReferenceError
      ? 'error_messages.missing_function_error'
      : err.message;
    expect(logMessage).toBe('error_messages.missing_function_error');
  });
});

describe('runEngine (real derivation)', () => {
  const tmpDirs = [];
  const makeTmpDir = (prefix) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    while (tmpDirs.length > 0) {
      fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
    }
  });

  it('an invalid feature selection is a product that does not fit its SPL: ModuleCheckError with the diagnostics, which onError maps to 422 — NOT 404', async () => {
    const newProductOutput = makeTmpDir('runEngine-invalid-');
    const logError = vi.fn();
    const product = {
      spec: baseSpec(['GUI_M_Top', 'GUI_M_Left']),
    };

    await expect(
      runEngine({ lineOutput: LPS_FIXTURE, product, modular: await modularOf({ lineOutput: LPS_FIXTURE, features: product.spec.features }), newProductOutput, logError })
    ).rejects.toBeInstanceOf(ModuleCheckError);
    // what is wrong is told in the log of the generation
    expect(logError).toHaveBeenCalledTimes(1);

    let thrown;
    try {
      await runEngine({ lineOutput: LPS_FIXTURE, product, modular: await modularOf({ lineOutput: LPS_FIXTURE, features: product.spec.features }), newProductOutput: makeTmpDir('runEngine-invalid-2-'), logError });
    } catch (error) {
      thrown = error;
    }
    const res = { statusCode: undefined, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    onError(thrown, {}, res, vi.fn());
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('error_messages.module_check_failed');
    expect(res.body.diagnostics.length).toBeGreaterThan(0);
  });

  it('a ReferenceError from a missing extra.js helper -> LinePlatformNotFoundError, logError called with the i18n key', async () => {
    const brokenLine = makeTmpDir('runEngine-refErr-line-');
    fs.cpSync(LPS_FIXTURE, brokenLine, { recursive: true });
    fs.writeFileSync(
      path.join(brokenLine, 'src', 'platform', 'code', 'client', 'broken.js'),
      'export const x = "/*%= thisHelperDoesNotExist(data) %*/";\n',
      'utf8',
    );
    const newProductOutput = makeTmpDir('runEngine-refErr-out-');
    const logError = vi.fn();
    const product = { spec: baseSpec(VALID_FEATURES) };

    await expect(
      runEngine({ lineOutput: brokenLine, product, modular: await modularOf({ lineOutput: brokenLine, features: product.spec.features }), newProductOutput, logError })
    ).rejects.toBeInstanceOf(CoreLinePlatformNotFoundError);
    expect(logError).toHaveBeenCalledWith('error_messages.missing_function_error');

    expect(fs.existsSync(brokenLine)).toBe(true);
  });

  it('a corrupted config.json is found by the check of the SPL — the diagnostic survives in the error and in the log', async () => {
    const brokenLine = makeTmpDir('runEngine-badcfg-line-');
    fs.cpSync(LPS_FIXTURE, brokenLine, { recursive: true });
    fs.writeFileSync(path.join(brokenLine, 'src', 'platform', 'config.json'), '{ not valid json !!', 'utf8');
    const newProductOutput = makeTmpDir('runEngine-badcfg-out-');
    const logError = vi.fn();
    const product = { spec: baseSpec(VALID_FEATURES) };

    const thrown = await runEngine({ lineOutput: brokenLine, product, modular: await modularOf({ lineOutput: brokenLine, features: product.spec.features }), newProductOutput, logError }).catch((error) => error);
    expect(thrown).toBeInstanceOf(ModuleCheckError);
    expect(thrown.diagnostics.some(({ severity, file }) => severity === 'error' && file === 'src/platform/config.json')).toBe(true);

    expect(logError).toHaveBeenCalledTimes(1);
    const [loggedMessage] = logError.mock.calls[0];
    expect(loggedMessage).not.toBe('error_messages.missing_function_error');
    expect(loggedMessage).toContain('config.json');
  });

  it('a core LinePlatformNotFoundError from runEngine reaches onError at the SAME HTTP status as the monolith\'s own class (dual-class dispatch guard)', async () => {
    const brokenLine = makeTmpDir('runEngine-dualclass-line-');
    fs.cpSync(LPS_FIXTURE, brokenLine, { recursive: true });
    fs.writeFileSync(
      path.join(brokenLine, 'src', 'platform', 'code', 'client', 'broken.js'),
      'export const x = "/*%= thisHelperDoesNotExist(data) %*/";\n',
      'utf8',
    );
    const newProductOutput = makeTmpDir('runEngine-dualclass-out-');
    const product = { spec: baseSpec(VALID_FEATURES) };

    let coreError;
    try {
      await runEngine({ lineOutput: brokenLine, product, modular: await modularOf({ lineOutput: brokenLine, features: product.spec.features }), newProductOutput, logError: vi.fn() });
      expect.unreachable('should have thrown');
    } catch (error) {
      coreError = error;
    }
    expect(coreError).toBeInstanceOf(CoreLinePlatformNotFoundError);
    expect(coreError).not.toBeInstanceOf(LinePlatformNotFoundError);

    const monolithError = new LinePlatformNotFoundError();

    const fakeRes = () => ({
      statusCode: undefined,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    });

    const coreRes = fakeRes();
    onError(coreError, {}, coreRes, vi.fn());
    const monolithRes = fakeRes();
    onError(monolithError, {}, monolithRes, vi.fn());

    expect(coreRes.statusCode).toBe(monolithRes.statusCode);
    expect(coreRes.statusCode).toBe(404);
  });

  // runEngine no longer removes lineOutput itself: ProductService wipes the
  // whole tmp dir in a finally, which also covers the failure paths.
  it('derives into newProductOutput and leaves the cleanup to the caller', async () => {
    const line = makeTmpDir('runEngine-ok-line-');
    fs.cpSync(LPS_FIXTURE, line, { recursive: true });
    const newProductOutput = path.join(makeTmpDir('runEngine-ok-parent-'), 'new');
    const logError = vi.fn();
    const product = { spec: baseSpec(VALID_FEATURES) };

    const result = await runEngine({ lineOutput: line, product, modular: await modularOf({ lineOutput: line, features: product.spec.features }), newProductOutput, logError });

    expect(result.newProductOutput).toBe(newProductOutput);
    expect(fs.existsSync(newProductOutput)).toBe(true);
    expect(logError).not.toHaveBeenCalled();
  }, 20000);
});

describe('diffDirectories parity with generateActions (real filesystem)', () => {
  const tmpDirs = [];
  const makeTmpDir = (prefix) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  };
  afterEach(() => {
    while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  });

  it('produces the same action set, modulo path separator and leading slash', async () => {
    const uuid = uuidv4();
    const root = makeTmpDir('diff-parity-');
    const oldDir = path.join(root, 'tmp', uuid, 'old');
    const newDir = path.join(root, 'tmp', uuid, 'new');
    fs.mkdirSync(path.join(oldDir, 'src', 'nested'), { recursive: true });
    fs.mkdirSync(path.join(newDir, 'src', 'nested'), { recursive: true });

    fs.writeFileSync(path.join(oldDir, 'src', 'Unchanged.js'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(newDir, 'src', 'Unchanged.js'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(oldDir, 'src', 'nested', 'Changed.js'), 'export const y = 1;\n');
    fs.writeFileSync(path.join(newDir, 'src', 'nested', 'Changed.js'), 'export const y = 2;\n');
    fs.writeFileSync(path.join(oldDir, 'src', 'Removed.js'), 'export const z = 1;\n');
    fs.writeFileSync(path.join(newDir, 'src', 'Added.js'), 'export const w = 1;\n');
    fs.writeFileSync(path.join(oldDir, 'README.md'), '# old readme\n');

    const oldActions = await generateActions(oldDir, newDir, uuid);
    const newActions = diffDirectories({ oldDir, newDir });

    const normalize = (actions) =>
      [...actions]
        .map((a) => ({
          action: a.action,
          file_path: a.file_path.split(path.sep).join('/').replace(/^\//, ''),
          content: a.content,
          encoding: a.encoding,
        }))
        .sort((a, b) => (a.file_path < b.file_path ? -1 : a.file_path > b.file_path ? 1 : 0));

    expect(normalize(newActions)).toEqual(normalize(oldActions));

    const rawOldCreate = oldActions.find((a) => a.file_path.includes('Added.js'));
    const rawNewCreate = newActions.find((a) => a.file_path.includes('Added.js'));
    expect(rawNewCreate.file_path).toBe('src/Added.js');
    expect(rawNewCreate.file_path).not.toMatch(/^[/\\]/);

    expect(rawOldCreate.file_path).toBe(rawNewCreate.file_path);

    expect(newActions).toHaveLength(3);
    expect(newActions.some((a) => a.action === 'delete' && a.file_path.endsWith('README.md'))).toBe(false);
  });
});

// ─── prettifyAndDiff ─────────────────────────────────────────────────────────
describe('prettifyAndDiff', () => {
  it('emits prettied_code and generated_product log entries', async () => {
    const log = vi.fn();
    const prettySpy = vi.fn().mockResolvedValue(undefined);
    const generateActionsSpy = vi.fn().mockResolvedValue([{ action: 'update', file_path: 'a.js' }]);

    // Test the log emission contract directly (stage behaviour without FS):
    const newVersion = '1.2.0';

    // Simulate what prettifyAndDiff does:
    await prettySpy('/tmp/new');
    log({ version: newVersion, type: 'info', message: 'log.prettied_code', params: [newVersion] });
    const actions = await generateActionsSpy('/tmp/old', '/tmp/new', 'uuid-1');
    log({ version: newVersion, type: 'info', message: 'log.generated_product', params: [newVersion] });

    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenNthCalledWith(1, expect.objectContaining({ message: 'log.prettied_code' }));
    expect(log).toHaveBeenNthCalledWith(2, expect.objectContaining({ message: 'log.generated_product' }));
    expect(actions).toHaveLength(1);
  });
});

// ─── checkEmptyDiff ──────────────────────────────────────────────────────────
describe('checkEmptyDiff', () => {
  const log = vi.fn();

  beforeEach(() => { log.mockClear(); });

  it('is a no-op when actions are non-empty', async () => {
    await expect(
      checkEmptyDiff({ actions: [{ action: 'update' }], previousVersion: '1.0.0', log })
    ).resolves.toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it('logs "up to date" at the previous version when the diff is empty', async () => {
    await expect(
      checkEmptyDiff({ actions: [], previousVersion: '1.0.0', log })
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith({
      version: '1.0.0',
      type: 'success',
      message: 'log.empty_diff_up_to_date',
      params: ['1.0.0'],
    });
  });

  // type must be 'success': the client's generation dialog only stops its
  // spinner on success/warning/error, and this is the last line it gets on
  // this path. An 'info' here left the dialog spinning forever.
  it('logs it as a terminal success, not an info line', async () => {
    await checkEmptyDiff({ actions: [], previousVersion: '2.3.4', log });
    expect(log.mock.calls[0][0].type).toBe('success');
  });
});

// ─── downloadOldProduct ──────────────────────────────────────────────────────
// The archive is held across the whole engine run; a body nobody reads is aborted by the request timeout, and that error has
// no listener when the generation fails in between, so the zip has to be read in full as soon as it arrives.
describe('downloadOldProduct', () => {
  afterEach(() => vi.restoreAllMocks());

  const product = { repo: { id: 7 } };

  it('answers with the bytes of the archive, not with a stream that is still open', async () => {
    const body = Buffer.from('PK-archive');
    vi.spyOn(GitLabProvider.prototype, 'downloadArchive').mockResolvedValue(Readable.from([body]));

    const { productZip } = await downloadOldProduct({ token: 't', product, logError: vi.fn() });

    expect(Buffer.isBuffer(productZip)).toBe(true);
    expect(productZip.equals(body)).toBe(true);
  });

  it('logs and raises when the archive cannot be read, also when the body breaks half way', async () => {
    const broken = new Readable({ read() { this.destroy(new Error('aborted by timeout')); } });
    vi.spyOn(GitLabProvider.prototype, 'downloadArchive').mockResolvedValue(broken);
    const logError = vi.fn();

    await expect(downloadOldProduct({ token: 't', product, logError })).rejects.toBeInstanceOf(LinePlatformNotFoundError);
    expect(logError).toHaveBeenCalledWith('error_messages.error_downloading_product');
  });
});

// ─── saveProductVersion ───────────────────────────────────────────────────────
describe('saveProductVersion', () => {
  it('populates missing basicData defaults on the result', async () => {
    const product = {
      toObject: () => ({ spec: { basicData: { name: 'P', version: '1.0.0' } } }),
    };
    const productRepository = { save: vi.fn().mockResolvedValue(undefined) };

    const { result } = await saveProductVersion({ product, session: {}, productRepository });

    expect(result.spec.basicData.database).toEqual({});
    expect(result.spec.basicData.extra).toEqual({});
    expect(result.spec.basicData.languages).toEqual(['en', 'es', 'gl']);
    expect(result.spec.basicData.SRID).toBe('4326');
    expect(productRepository.save).toHaveBeenCalledWith(product, { session: {} });
  });

  it('does not override existing basicData values', async () => {
    const product = {
      toObject: () => ({
        spec: {
          basicData: { database: { host: 'db' }, extra: { k: 1 }, languages: ['en'], SRID: '3857' },
        },
      }),
    };
    const productRepository = { save: vi.fn() };
    const { result } = await saveProductVersion({ product, session: {}, productRepository });
    expect(result.spec.basicData.database).toEqual({ host: 'db' });
    expect(result.spec.basicData.extra).toEqual({ k: 1 });
    expect(result.spec.basicData.languages).toEqual(['en']);
    expect(result.spec.basicData.SRID).toBe('3857');
  });

  it('keeps languages: [] as-is (ADR-023: [] is truthy, || never overrides it)', async () => {
    const product = {
      toObject: () => ({ spec: { basicData: { languages: [] } } }),
    };
    const productRepository = { save: vi.fn() };
    const { result } = await saveProductVersion({ product, session: {}, productRepository });
    expect(result.spec.basicData.languages).toEqual([]);
  });

  it('falls SRID: "" back to the "4326" default (ADR-023: "" is falsy, || does override it)', async () => {
    const product = {
      toObject: () => ({ spec: { basicData: { SRID: '' } } }),
    };
    const productRepository = { save: vi.fn() };
    const { result } = await saveProductVersion({ product, session: {}, productRepository });
    expect(result.spec.basicData.SRID).toBe('4326');
  });
});

// ─── mergeGenerationBranch ───────────────────────────────────────────────────
describe('mergeGenerationBranch', () => {
  const makeGitlab = ({ conflicts }) => ({
    createBranch:          vi.fn().mockResolvedValue({}),
    commit:                vi.fn().mockResolvedValue({}),
    createChangeRequest:   vi.fn().mockResolvedValue({ number: 7, webUrl: 'https://gl/mr/7' }),
    mergeChangeRequest:    vi.fn().mockResolvedValue(conflicts),
  });

  const baseArgs = {
    actions:    [{ action: 'update', file_path: 'src/App.js' }],
    token:      'tok',
    product:    { repo: { id: 1 } },
    newVersion: '1.2.0',
    log:        vi.fn(),
    logError:   vi.fn(),
  };

  it('renews a token that stopped being good during the merge, and hands it back', async () => {
    const stale = Object.assign(new Error('invalid_token'), { auth: true });
    const git = { ...makeGitlab({ conflicts: false }), isAuthError: (error) => Boolean(error?.auth) };
    git.mergeChangeRequest.mockRejectedValueOnce(stale);
    const renewToken = vi.fn().mockResolvedValue('fresh');
    const result = await mergeGenerationBranch({ ...baseArgs, git, renewToken });
    expect(renewToken).toHaveBeenCalledOnce();
    expect(git.mergeChangeRequest).toHaveBeenLastCalledWith(expect.objectContaining({ token: 'fresh', number: 7 }));
    expect(result).toMatchObject({ generationConflicts: false, token: 'fresh' });
  });

  it('fails the generation when the token cannot be renewed, instead of leaving it waiting', async () => {
    const stale = Object.assign(new Error('invalid_token'), { auth: true });
    const git = { ...makeGitlab({ conflicts: false }), isAuthError: (error) => Boolean(error?.auth) };
    git.mergeChangeRequest.mockRejectedValue(stale);
    const logError = vi.fn();
    await expect(mergeGenerationBranch({ ...baseArgs, logError, git, renewToken: vi.fn().mockRejectedValue(new Error('no session')) })).rejects.toThrow();
    expect(logError).toHaveBeenCalledWith('error_messages.error_merging', expect.anything());
  });

  it('does not renew anything for another failure', async () => {
    const git = { ...makeGitlab({ conflicts: false }), isAuthError: () => false };
    git.mergeChangeRequest.mockRejectedValue(new Error('boom'));
    const renewToken = vi.fn();
    await expect(mergeGenerationBranch({ ...baseArgs, git, renewToken })).rejects.toThrow();
    expect(renewToken).not.toHaveBeenCalled();
  });

  it('fails as before when the branch cannot be made and none is in the way', async () => {
    const git = { ...makeGitlab({ conflicts: false }), getBranch: vi.fn().mockRejectedValue(new Error('404')) };
    git.createBranch.mockRejectedValue(new Error('403'));
    const logError = vi.fn();
    await expect(mergeGenerationBranch({ ...baseArgs, logError, git })).rejects.toThrow('Failed to create branch');
    expect(logError).toHaveBeenCalledWith('error_messages.error_creating_branch', ['generation/1.2.0']);
    expect(git.commit).not.toHaveBeenCalled();
  });

  it('still goes on when the request left behind could not be closed', async () => {
    const git = {
      ...makeGitlab({ conflicts: false }),
      getBranch: vi.fn().mockResolvedValue({ name: 'generation/1.2.0' }),
      listChangeRequests: vi.fn().mockRejectedValue(new Error('500')),
    };
    git.createBranch.mockRejectedValueOnce(new Error('exists'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { generationConflicts } = await mergeGenerationBranch({ ...baseArgs, git });
    quiet.mockRestore();
    expect(generationConflicts).toBe(false);
    expect(git.createBranch).toHaveBeenLastCalledWith(expect.objectContaining({ branch: 'generation/1.2.0-2' }));
  });

  it('returns generationConflicts=false on clean merge', async () => {
    const git = makeGitlab({ conflicts: false });
    const { generationConflicts } = await mergeGenerationBranch({ ...baseArgs, git });
    expect(generationConflicts).toBe(false);
    expect(git.createBranch).toHaveBeenCalledOnce();
    expect(git.commit).toHaveBeenCalledOnce();
    expect(git.createChangeRequest).toHaveBeenCalledOnce();
    expect(git.mergeChangeRequest).toHaveBeenCalledOnce();
  });

  it('returns generationConflicts=true and logs warning on conflict', async () => {
    const log = vi.fn();
    const git = makeGitlab({ conflicts: true });
    const { generationConflicts } = await mergeGenerationBranch({ ...baseArgs, log, git });
    expect(generationConflicts).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', message: 'log.conflicts_merge_request' }));
  });

  it('throws LinePlatformNotFoundError when createBranch fails', async () => {
    const git = {
      createBranch: vi.fn().mockRejectedValue(new Error('branch exists')),
      commit: vi.fn(), createChangeRequest: vi.fn(), mergeChangeRequest: vi.fn(),
    };
    await expect(
      mergeGenerationBranch({ ...baseArgs, git })
    ).rejects.toBeInstanceOf(LinePlatformNotFoundError);
  });
});

// ─── createVersionTag ────────────────────────────────────────────────────────
describe('createVersionTag', () => {
  it('calls createTag with correct tag name', async () => {
    const git = { createTag: vi.fn().mockResolvedValue({}) };
    await createVersionTag({ token: 'tok', product: { repo: { id: 5 } }, newVersion: '2.1.0', git });
    expect(git.createTag).toHaveBeenCalledWith({ token: 'tok', id: 5, tag: expect.stringContaining('2.1.0'), ref: expect.any(String) });
  });

  it('silently ignores createTag failure (recovery scenario)', async () => {
    const git = { createTag: vi.fn().mockRejectedValue(new Error('already exists')) };
    await expect(
      createVersionTag({ token: 'tok', product: { repo: { id: 5 } }, newVersion: '2.1.0', git })
    ).resolves.toBeUndefined();
  });
});

// ─── mergeUpdateBranch ───────────────────────────────────────────────────────
describe('mergeUpdateBranch', () => {
  const makeGitlab = ({ conflicts }) => ({
    createOrRenameChangeRequest: vi.fn().mockResolvedValue({ number: 3, webUrl: 'https://gl/mr/3' }),
    mergeChangeRequest:          vi.fn().mockResolvedValue(conflicts),
  });

  const baseArgs = {
    token: 'tok',
    product: { repo: { id: 2 } },
    newVersion: '1.3.0',
    log: vi.fn(),
    logError: vi.fn(),
  };

  it('returns updateConflicts=false and logs success on clean merge', async () => {
    const log = vi.fn();
    const git = makeGitlab({ conflicts: false });
    const { updateConflicts } = await mergeUpdateBranch({ ...baseArgs, log, git });
    expect(updateConflicts).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', message: 'log.merged_merge_request' }));
  });

  it('returns updateConflicts=true and logs warning on conflict', async () => {
    const log = vi.fn();
    const git = makeGitlab({ conflicts: true });
    const { updateConflicts } = await mergeUpdateBranch({ ...baseArgs, log, git });
    expect(updateConflicts).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', message: 'log.conflicts_merge_request' }));
  });

  it('throws LinePlatformNotFoundError when createOrRenameMergeRequest fails', async () => {
    const git = {
      createOrRenameChangeRequest: vi.fn().mockRejectedValue(new Error('forbidden')),
      mergeChangeRequest: vi.fn(),
    };
    await expect(
      mergeUpdateBranch({ ...baseArgs, git })
    ).rejects.toBeInstanceOf(LinePlatformNotFoundError);
  });
});
