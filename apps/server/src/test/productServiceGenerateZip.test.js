import { GitLabProvider } from '@lbdudc/linea-git';
import { stubMissingFileRevisions, stubUntrackedCommits } from './support/gitStubs.js';
import User from '../model/entities/user.js';
import { createGroupMock, createRepositoryMock, createFileMock, getProjectMembersMock } from './mocks/index.js';
import bcrypt from 'bcrypt';
import { setup, clear, teardown } from './setup.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';
import { Readable } from 'stream';
import { vi, test, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { GitLabSession } from 'gitlab-commando';
import fsPromises from 'fs/promises';
import { Container } from 'typedi';
import { stubModular } from './support/stubModular.js';
import ProductService from '../model/services/ProductService.js';
import LineService from '../model/services/LineService.js';
import { deriveModularProductToZip, ModuleCheckError } from '@lbdudc/linea-core';
import { createEngine } from '../model/services/modules/engine.js';
import { modularOf } from './support/derivation.js';
import { onError } from '../rest/common/onError.js';

beforeEach(() => {
  stubMissingFileRevisions();
  stubUntrackedCommits();
  stubModular();
});

const lineService = Container.get(LineService);
const productService = Container.get(ProductService);

const LPS_FIXTURE = path.resolve('src', 'test', 'mocks', 'lps');
const VALID_FEATURES = [
  'GEMA_SPL', 'DataManagement', 'GraphicalUserInterface', 'MapViewer', 'Tools',
  'DM_SpatialDatabase', 'DM_GenerationType', 'DM_DataServer', 'MV_MapServer', 'MV_Tools',
  'MV_MapManagement', 'DM_SD_PostGIS', 'MV_T_Pan', 'MV_T_Zoom', 'DM_GT_Identity',
  'MV_MS_GeoServer', 'MV_MM_UniqueMapViewer', 'MV_MM_UMV_MapCenter', 'MV_MM_UMV_MC_BBox', 'T_GIS',
];

async function zipFixtureAsGitlabArchive() {
  const zip = new JSZip();
  const wrapper = zip.folder('line-repo-abc123');
  const addDir = (dir, folder) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) addDir(full, folder.folder(entry.name));
      else folder.file(entry.name, fs.readFileSync(full));
    }
  };
  addDir(LPS_FIXTURE, wrapper);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function unzipToMap(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const out = {};
  for (const [relPath, file] of Object.entries(zip.files)) {
    if (!file.dir) out[relPath] = await file.async('nodebuffer');
  }
  return out;
}

async function createLineAndProduct({ features }) {
  const password = 'password';
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await new User({ username: `zipuser-${Date.now()}-${Math.random()}`, password: hashedPassword, admin: true }).save();

  vi.spyOn(GitLabSession.prototype, 'getProjectMembers').mockReturnValue(JSON.parse(getProjectMembersMock));
  vi.spyOn(GitLabSession.prototype, 'createGroup').mockReturnValue(JSON.parse(createGroupMock));
  vi.spyOn(GitLabSession.prototype, 'createProject').mockReturnValue(JSON.parse(createRepositoryMock));
  vi.spyOn(GitLabSession.prototype, 'createFile').mockReturnValue(JSON.parse(createFileMock));

  const line = await lineService.createLine({
    name: `ZIPLINE${Date.now()}${Math.floor(Math.random() * 1e6)}`,
    version: '0.0.0',
    description: 'zip test line',
    userId: user._id,
  });

  const productData = {
    spec: {
      basicData: { name: 'ZipProduct', version: '0.0.0', database: {}, languages: ['en'] },
      dataModel: { cells: [] },
      features,
      statics: [],
    },
    lineId: line._id,
  };

  vi.spyOn(GitLabSession.prototype, 'createBranch').mockReturnValue({});
  vi.spyOn(GitLabSession.prototype, 'setDefaultBranch').mockReturnValue({});

  vi.spyOn(GitLabSession.prototype, 'getFile').mockRejectedValue(new Error('no model configured yet'));

  const product = await productService.createProduct({ ...productData, userId: user._id });
  // the product has no models in this test: it is derived with the selection it was made with
  stubModular({ features });
  return { user, line, product };
}

test('generateZip: the base64 body unzips to the same tree as deriveProductToZip on the same fixture', async () => {
  const mockMk = vi.spyOn(fsPromises, 'mkdir');
  const mockWriteFile = vi.spyOn(fsPromises, 'writeFile');
  try {
    const { user, product } = await createLineAndProduct({ features: VALID_FEATURES });

    const archiveBuffer = await zipFixtureAsGitlabArchive();
    vi.spyOn(GitLabProvider.prototype, 'downloadArchive').mockResolvedValue(Readable.from(archiveBuffer));

    const zipBuffer = await productService.generateZip({
      id: product._id,
      spec: product.spec,
      userId: user._id,
    });

    expect(Buffer.isBuffer(zipBuffer)).toBe(true);

    const expectedBuffer = await deriveModularProductToZip({ ...(await modularOf({ lineOutput: LPS_FIXTURE, features: VALID_FEATURES })), spec: product.spec, createEngine });

    const [actualFiles, expectedFiles] = await Promise.all([
      unzipToMap(zipBuffer),
      unzipToMap(expectedBuffer),
    ]);

    expect(Object.keys(actualFiles).sort()).toEqual(Object.keys(expectedFiles).sort());
    for (const relPath of Object.keys(expectedFiles)) {
      expect(actualFiles[relPath].equals(expectedFiles[relPath])).toBe(true);
    }
  } finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
  }
}, 60000);

test('generateZip: cleans up its tmp directory even when derivation fails', async () => {
  const mockMk = vi.spyOn(fsPromises, 'mkdir');
  const mockWriteFile = vi.spyOn(fsPromises, 'writeFile');
  try {
    const { user, product } = await createLineAndProduct({ features: ['GUI_M_Top', 'GUI_M_Left'] });

    const archiveBuffer = await zipFixtureAsGitlabArchive();
    vi.spyOn(GitLabProvider.prototype, 'downloadArchive').mockResolvedValue(Readable.from(archiveBuffer));

    const { properties } = await import('../model/connectors/properties.js');
    const originalOutput = properties.paths.output;
    const isolatedOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'genzip-cleanup-'));
    properties.paths.output = isolatedOutput;

    let thrown;
    try {
      const before = fs.readdirSync(isolatedOutput);

      try {
        await productService.generateZip({ id: product._id, spec: product.spec, userId: user._id });
        expect.unreachable('should have thrown');
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ModuleCheckError);

      expect(fs.readdirSync(isolatedOutput)).toEqual(before);
    } finally {
      properties.paths.output = originalOutput;
      fs.rmSync(isolatedOutput, { recursive: true, force: true });
    }

    const res = { statusCode: undefined, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    onError(thrown, {}, res, vi.fn());
    expect(res.statusCode).toBe(422);
  } finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
  }
}, 60000);

beforeAll(setup);
afterEach(clear);
afterAll(teardown);
