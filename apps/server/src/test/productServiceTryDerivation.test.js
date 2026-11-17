import { GitLabProvider } from '@lbdudc/linea-git';
import { stubMissingFileRevisions, stubUntrackedCommits } from './support/gitStubs.js';
import Product from '../model/entities/product.js';
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
import ModularService from '../model/services/modules/ModularService.js';
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


test('tryDerivation: derives a configuration without making a product, and applies the files not committed yet', async () => {
  const { user, line } = await createLineAndProduct({ features: VALID_FEATURES });
  const modular = Container.get(ModularService);
  vi.spyOn(modular, 'prepareTrial').mockImplementation(async ({ lineOutput, features }) => modularOf({ lineOutput, features }));
  const archiveBuffer = await zipFixtureAsGitlabArchive();
  vi.spyOn(GitLabProvider.prototype, 'downloadArchive').mockImplementation(async () => Readable.from(archiveBuffer));
  const products = await Product.countDocuments();

  const result = await productService.tryDerivation({ lineId: line._id, features: VALID_FEATURES, userId: user._id });
  expect(result).toMatchObject({ ok: true });
  expect(result.files.length).toBeGreaterThan(0);
  expect(await Product.countDocuments()).toBe(products);

  const none = await productService.tryDerivation({ lineId: line._id, features: VALID_FEATURES, userId: user._id, overrides: [{ path: 'src/main/resources/templates/x.txt', action: 'create', content: 'hi' }] });
  expect(none.ok).toBe(true);

  // `include`: what some files of the output hold, to see the result for one file; one that is not there is left out
  const one = await productService.tryDerivation({ lineId: line._id, features: VALID_FEATURES, userId: user._id, include: [result.files[0], 'no/such/file.txt'] });
  expect(Object.keys(one.contents)).toEqual([result.files[0]]);
  expect(typeof one.contents[result.files[0]]).toBe('string');
  expect(result.contents).toBeUndefined();
  expect(result.zip).toBeUndefined();
  // `zip`: the whole product, as base64 of a zip
  const whole = await productService.tryDerivation({ lineId: line._id, features: VALID_FEATURES, userId: user._id, zip: true });
  expect(Buffer.from(whole.zip, 'base64').subarray(0, 2).toString()).toBe('PK');
  expect(Buffer.from(whole.zip, 'base64').length).toBe(whole.size);
}, 60000);

test('tryDerivation: a configuration that does not derive answers the errors, not a failure', async () => {
  const { user, line } = await createLineAndProduct({ features: ['GUI_M_Top', 'GUI_M_Left'] });
  const modular = Container.get(ModularService);
  vi.spyOn(modular, 'prepareTrial').mockImplementation(async ({ lineOutput, features }) => modularOf({ lineOutput, features }));
  const archiveBuffer = await zipFixtureAsGitlabArchive();
  vi.spyOn(GitLabProvider.prototype, 'downloadArchive').mockImplementation(async () => Readable.from(archiveBuffer));

  const result = await productService.tryDerivation({ lineId: line._id, features: ['GUI_M_Top', 'GUI_M_Left'], userId: user._id });
  expect(result.ok).toBe(false);
  expect(result.error).toBeTruthy();
}, 60000);

test('tryDerivation: refuses an override outside the platform', async () => {
  const { user, line } = await createLineAndProduct({ features: VALID_FEATURES });
  const modular = Container.get(ModularService);
  vi.spyOn(modular, 'prepareTrial').mockImplementation(async ({ lineOutput, features }) => modularOf({ lineOutput, features }));
  const archiveBuffer = await zipFixtureAsGitlabArchive();
  vi.spyOn(GitLabProvider.prototype, 'downloadArchive').mockImplementation(async () => Readable.from(archiveBuffer));
  await expect(productService.tryDerivation({ lineId: line._id, features: VALID_FEATURES, userId: user._id, overrides: [{ path: '../evil', action: 'create', content: 'x' }] }))
    .rejects.toMatchObject({ status: 400 });
}, 60000);

beforeAll(setup);
afterEach(clear);
afterAll(teardown);
