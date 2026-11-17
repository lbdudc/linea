import { GitLabProvider } from '@lbdudc/linea-git';
import { stubMissingFileRevisions, stubUntrackedCommits, stubBranchesAndTags } from './support/gitStubs.js';
import { properties } from '../model/connectors/properties.js';
import User from '../model/entities/user.js';
import { AlreadyExistentProductError, PermissionError, LineNotFoundError } from '../model/errors/errors.js';
import { createGroupMock, createRepositoryMock, createFileMock, createBranchMock, createTagMock, commitMock, getFileMock, createMergeRequestMock, getProjectMembersMock } from './mocks/index.js';
import bcrypt from 'bcrypt';
import { setup, clear, teardown } from './setup.js';
import mongoose from 'mongoose';
import fs from "fs";
import path from "path";
import { vi, test, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { GitLabSession } from "gitlab-commando";
import fsPromises from 'fs/promises';
import { Container } from 'typedi';
import { stubModular } from './support/stubModular.js';
import ProductService from '../model/services/ProductService.js';
import LineService from '../model/services/LineService.js';

vi.mock('@lbdudc/linea-core', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    extractArchive: vi.fn(async ({ destDir }) => ({
      dir: path.resolve('src', 'test', 'mocks', path.basename(destDir) === 'line' ? 'lps' : 'product'),
    })),
  };
});

beforeEach(() => {
  stubMissingFileRevisions();
  stubUntrackedCommits();
  stubBranchesAndTags();
  stubModular();
});

const lineService = Container.get(LineService);
const productService = Container.get(ProductService);

test('Create product successfully', async () => {
  const mockMk = vi.spyOn(fsPromises, 'mkdir');
  const mockWriteFile = vi.spyOn(fsPromises, 'writeFile');
  try {
    const username = 'user';
    const password = 'password';
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await new User({ username, password: hashedPassword }).save();

    const name = 'GEMA';
    const version = '0.0.0';
    const description = `LPS de GEMA. Incluye tanto la interfaz de 
        especificación como el código fuente de la plataforma, 
        así como especificaciones de productos varios.`;

    mockMk.mockReset();
    mockWriteFile.mockReset();

    const mockGetProjectMembers = vi.spyOn(GitLabSession.prototype, 'getProjectMembers');
    mockGetProjectMembers.mockReturnValue(JSON.parse(getProjectMembersMock));

    const mockCreateGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateGroup.mockReturnValue(JSON.parse(createGroupMock));

    const mockCreateRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateRepository.mockReturnValue(JSON.parse(createRepositoryMock));

    const mockCreateFile = vi.spyOn(GitLabSession.prototype, 'createFile');
    mockCreateFile.mockReturnValue(JSON.parse(createFileMock));

    const line = await lineService.createLine({name, version, description, userId: user._id});

    const productData = {
        spec: {
          basicData: {
            name: 'SampleProduct',
            version: '0.0.0',
            database: {},
            languages: [ 'en', 'es', 'gl' ],
          },
          dataModel: { cells: [] },
          features: [
            "GEMA_SPL",
            "DataManagement",
            "GraphicalUserInterface",
            "MapViewer",
            "Tools",
            "DM_SpatialDatabase",
            "DM_GenerationType",
            "DM_DataServer",
            "MV_MapServer",
            "MV_Tools",
            "MV_MapManagement",
            "DM_SD_PostGIS",
            "MV_T_Pan",
            "MV_T_Zoom",
            "DM_GT_Identity",
            "MV_MS_GeoServer",
            "MV_MM_UniqueMapViewer",
            "MV_MM_UMV_MapCenter",
            "MV_MM_UMV_MC_BBox",
            "T_GIS"
          ],
          statics: []
        },
        lineId: line._id
      };

    const mockGetFile = vi.spyOn(GitLabSession.prototype, 'getFile');
    mockGetFile.mockReturnValue(JSON.parse(getFileMock));

    const mockCreateProductGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateProductGroup.mockReturnValue(JSON.parse(createGroupMock.replace(new RegExp(name, 'g'), productData.spec.basicData.name)));

    const mockCreateProductRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateProductRepository.mockReturnValue(JSON.parse(createRepositoryMock.replace(new RegExp(name, 'g'), productData.spec.basicData.name)));

    const mockCreateBranch = vi.spyOn(GitLabSession.prototype, 'createBranch');
    mockCreateBranch.mockReturnValue(createBranchMock);

    const mockSetDefaultBranch = vi.spyOn(GitLabSession.prototype, 'setDefaultBranch');
    mockSetDefaultBranch.mockReturnValue(createRepositoryMock);
    
    const product = await productService.createProduct({...productData, userId: user._id});

    expect(product.spec).toMatchObject(productData.spec);
    expect(product.lineId).toBe(productData.lineId);
  } finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
  }
});

test('Create already existent product', async () => {
  const mockMk = vi.spyOn(fsPromises, 'mkdir');
  const mockWriteFile = vi.spyOn(fsPromises, 'writeFile');
  try {
    const username = 'user';
    const password = 'password';
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await new User({ username, password: hashedPassword }).save();

    const name = 'GEMA';
    const version = '0.0.0';
    const description = `LPS de GEMA. Incluye tanto la interfaz de 
        especificación como el código fuente de la plataforma, 
        así como especificaciones de productos varios.`;

    mockMk.mockReset();
    mockWriteFile.mockReset();

    const mockGetProjectMembers = vi.spyOn(GitLabSession.prototype, 'getProjectMembers');
    mockGetProjectMembers.mockReturnValue(JSON.parse(getProjectMembersMock));

    const mockCreateGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateGroup.mockReturnValue(JSON.parse(createGroupMock));

    const mockCreateRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateRepository.mockReturnValue(JSON.parse(createRepositoryMock));

    const mockCreateFile = vi.spyOn(GitLabSession.prototype, 'createFile');
    mockCreateFile.mockReturnValue(JSON.parse(createFileMock));

    const line = await lineService.createLine({name, version, description, userId: user._id});

    const productData = {
        spec: {
          basicData: {
            name: 'SampleProduct',
            version: '0.0.0',
            database: {},
            languages: [ 'en', 'es', 'gl' ],
          },
          dataModel: { cells: [] },
          features: [
            "GEMA_SPL",
            "DataManagement",
            "GraphicalUserInterface",
            "MapViewer",
            "Tools",
            "DM_SpatialDatabase",
            "DM_GenerationType",
            "DM_DataServer",
            "MV_MapServer",
            "MV_Tools",
            "MV_MapManagement",
            "DM_SD_PostGIS",
            "MV_T_Pan",
            "MV_T_Zoom",
            "DM_GT_Identity",
            "MV_MS_GeoServer",
            "MV_MM_UniqueMapViewer",
            "MV_MM_UMV_MapCenter",
            "MV_MM_UMV_MC_BBox",
            "T_GIS"
          ],
          statics: []
        },
        lineId: line._id
      };
    
    const mockGetFile = vi.spyOn(GitLabSession.prototype, 'getFile');
    mockGetFile.mockReturnValue(JSON.parse(getFileMock));

    const mockCreateProductGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateProductGroup.mockReturnValue(JSON.parse(createGroupMock.replace(new RegExp(name, 'g'), productData.spec.basicData.name)));

    const mockCreateProductRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateProductRepository.mockReturnValue(JSON.parse(createRepositoryMock.replace(new RegExp(name, 'g'), productData.spec.basicData.name)));

    const mockCreateBranch = vi.spyOn(GitLabSession.prototype, 'createBranch');
    mockCreateBranch.mockReturnValue(createBranchMock);

    const mockSetDefaultBranch = vi.spyOn(GitLabSession.prototype, 'setDefaultBranch');
    mockSetDefaultBranch.mockReturnValue(createRepositoryMock);
    
    await productService.createProduct({...productData, userId: user._id});
    await expect(() => productService.createProduct({...productData, userId: user._id})).rejects.toThrow(AlreadyExistentProductError);
  } finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
  }
});

test('Create product with non-existent line', async () => {
    const username = 'user';
    const password = 'password';
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await new User({ username, password: hashedPassword }).save();
    const nonExistentId = new mongoose.Types.ObjectId();

    const productData = {
        spec: {
          basicData: {
            name: 'SampleProduct',
            version: '0.0.0',
            database: {},
            languages: [ 'en', 'es', 'gl' ],
          },
          dataModel: { cells: [] },
          features: [
            "GEMA_SPL",
            "DataManagement",
            "GraphicalUserInterface",
            "MapViewer",
            "Tools",
            "DM_SpatialDatabase",
            "DM_GenerationType",
            "DM_DataServer",
            "MV_MapServer",
            "MV_Tools",
            "MV_MapManagement",
            "DM_SD_PostGIS",
            "MV_T_Pan",
            "MV_T_Zoom",
            "DM_GT_Identity",
            "MV_MS_GeoServer",
            "MV_MM_UniqueMapViewer",
            "MV_MM_UMV_MapCenter",
            "MV_MM_UMV_MC_BBox",
            "T_GIS"
          ],
          statics: []
        },
        lineId: nonExistentId
      };

    const mockCreateProductGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateProductGroup.mockReturnValue(JSON.parse(createGroupMock.replace(/GEMA/g, productData.spec.basicData.name)));

    const mockCreateProductRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateProductRepository.mockReturnValue(JSON.parse(createRepositoryMock.replace(/GEMA/g, productData.spec.basicData.name)));

    const mockCreateBranch = vi.spyOn(GitLabSession.prototype, 'createBranch');
    mockCreateBranch.mockReturnValue(createBranchMock);

    const mockSetDefaultBranch = vi.spyOn(GitLabSession.prototype, 'setDefaultBranch');
    mockSetDefaultBranch.mockReturnValue(createRepositoryMock);
    
    await expect(() => productService.createProduct({...productData, userId: user._id})).rejects.toThrow(LineNotFoundError);
  });

test('Find product successfully', async () => {
  const mockMk = vi.spyOn(fsPromises, 'mkdir');
  const mockWriteFile = vi.spyOn(fsPromises, 'writeFile');
  const mockRm = vi.spyOn(fs, 'rmSync');
  try {
    const username = 'user';
    const password = 'password';
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await new User({ username, password: hashedPassword }).save();

    const name = 'GEMA';
    const version = '0.0.0';
    const description = `LPS de GEMA. Incluye tanto la interfaz de 
        especificación como el código fuente de la plataforma, 
        así como especificaciones de productos varios.`;

    mockMk.mockReset();
    mockWriteFile.mockReset();

    const mockCreateGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateGroup.mockReturnValue(JSON.parse(createGroupMock));

    const mockCreateRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateRepository.mockReturnValue(JSON.parse(createRepositoryMock));

    const mockCreateFile = vi.spyOn(GitLabSession.prototype, 'createFile');
    mockCreateFile.mockReturnValue(JSON.parse(createFileMock));

    const line = await lineService.createLine({name, version, description, userId: user._id});

    const productData = {
        spec: {
          basicData: {
            name: 'SampleProduct',
            version: '0.0.0',
            database: { url: 'mongodb://localhost:27017'},
            languages: [ 'en', 'es', 'gl' ],
          },
          dataModel: { cells: [] },
          features: [
            "GEMA_SPL",
            "DataManagement",
            "GraphicalUserInterface",
            "MapViewer",
            "Tools",
            "DM_SpatialDatabase",
            "DM_GenerationType",
            "DM_DataServer",
            "MV_MapServer",
            "MV_Tools",
            "MV_MapManagement",
            "DM_SD_PostGIS",
            "MV_T_Pan",
            "MV_T_Zoom",
            "DM_GT_Identity",
            "MV_MS_GeoServer",
            "MV_MM_UniqueMapViewer",
            "MV_MM_UMV_MapCenter",
            "MV_MM_UMV_MC_BBox",
            "T_GIS"
          ],
          statics: []
        },
        lineId: line._id
      };

    const mockGetFile = vi.spyOn(GitLabSession.prototype, 'getFile');
    mockGetFile.mockReturnValue(JSON.parse(getFileMock));

    const mockGetProjectMembers = vi.spyOn(GitLabSession.prototype, 'getProjectMembers');
    mockGetProjectMembers.mockReturnValue(JSON.parse(getProjectMembersMock));

    const mockCreateProductGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateProductGroup.mockReturnValue(JSON.parse(createGroupMock.replace(new RegExp(name, 'g'), productData.spec.basicData.name)));

    const mockCreateProductRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateProductRepository.mockReturnValue(JSON.parse(createRepositoryMock.replace(new RegExp(name, 'g'), productData.spec.basicData.name)));

    const mockCreateBranch = vi.spyOn(GitLabSession.prototype, 'createBranch');
    mockCreateBranch.mockReturnValue(createBranchMock);

    const mockSetDefaultBranch = vi.spyOn(GitLabSession.prototype, 'setDefaultBranch');
    mockSetDefaultBranch.mockReturnValue(createRepositoryMock);

    const mockDownloadRepositoryFile = vi.spyOn(GitLabProvider.prototype, 'downloadArchive');
    mockDownloadRepositoryFile.mockReset();

    mockRm.mockReset();
    
    const product = await productService.createProduct({...productData, userId: user._id});
    const foundProduct = await productService.findProductById({ id: product._id, userId: user._id });

    expect(foundProduct.spec).toMatchObject(productData.spec);
  } finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
    mockRm.mockRestore();
  }
});

test('Find product without privileges', async () => {
  const mockMk = vi.spyOn(fsPromises, 'mkdir');
  const mockWriteFile = vi.spyOn(fsPromises, 'writeFile');
  try {
  const username = 'user';
  const password = 'password';
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await new User({ username, password: hashedPassword }).save();
  const user2 = await new User({ username: username+2, password: hashedPassword }).save();

  const name = 'GEMA';
  const version = '0.0.0';
  const description = `LPS de GEMA. Incluye tanto la interfaz de 
      especificación como el código fuente de la plataforma, 
      así como especificaciones de productos varios.`;

  mockMk.mockReset();
  mockWriteFile.mockReset();

  const mockGetProjectMembers = vi.spyOn(GitLabSession.prototype, 'getProjectMembers');
  mockGetProjectMembers.mockReturnValue(JSON.parse(getProjectMembersMock));

  const mockCreateGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
  mockCreateGroup.mockReturnValue(JSON.parse(createGroupMock));

  const mockCreateRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
  mockCreateRepository.mockReturnValue(JSON.parse(createRepositoryMock));

  const mockCreateFile = vi.spyOn(GitLabSession.prototype, 'createFile');
  mockCreateFile.mockReturnValue(JSON.parse(createFileMock));

  const line = await lineService.createLine({name, version, description, userId: user._id});

  const productData = {
      spec: {
        basicData: {
          name: 'SampleProduct',
          version: '0.0.0',
          database: { url: 'mongodb://localhost:27017'},
          languages: [ 'en', 'es', 'gl' ],
        },
        dataModel: { cells: [] },
        features: [
          "GEMA_SPL",
          "DataManagement",
          "GraphicalUserInterface",
          "MapViewer",
          "Tools",
          "DM_SpatialDatabase",
          "DM_GenerationType",
          "DM_DataServer",
          "MV_MapServer",
          "MV_Tools",
          "MV_MapManagement",
          "DM_SD_PostGIS",
          "MV_T_Pan",
          "MV_T_Zoom",
          "DM_GT_Identity",
          "MV_MS_GeoServer",
          "MV_MM_UniqueMapViewer",
          "MV_MM_UMV_MapCenter",
          "MV_MM_UMV_MC_BBox",
          "T_GIS"
        ],
        statics: []
      },
      lineId: line._id
    };

  const mockGetFile = vi.spyOn(GitLabSession.prototype, 'getFile');
  mockGetFile.mockReturnValue(JSON.parse(getFileMock));

  const mockCreateProductGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
  mockCreateProductGroup.mockReturnValue(JSON.parse(createGroupMock.replace(new RegExp(name, 'g'), productData.spec.basicData.name)));

  const mockCreateProductRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
  mockCreateProductRepository.mockReturnValue(JSON.parse(createRepositoryMock.replace(new RegExp(name, 'g'), productData.spec.basicData.name)));

  const mockCreateBranch = vi.spyOn(GitLabSession.prototype, 'createBranch');
  mockCreateBranch.mockReturnValue(createBranchMock);

  const mockSetDefaultBranch = vi.spyOn(GitLabSession.prototype, 'setDefaultBranch');
  mockSetDefaultBranch.mockReturnValue(createRepositoryMock);
  
  const product = await productService.createProduct({...productData, userId: user._id});

  const mockGetProjectMembers2 = vi.spyOn(GitLabSession.prototype, 'getProjectMembers');
  mockGetProjectMembers2.mockReturnValue(JSON.parse(getProjectMembersMock.replace(new RegExp(username+2, 'g'), 'smith')));

  await expect(() => productService.findProductById({ id: product._id, userId: user2._id })).rejects.toThrow(PermissionError);
} finally {
  mockMk.mockRestore();
  mockWriteFile.mockRestore();
}
});

test('Find product with admin user', async () => {
  const mockMk = vi.spyOn(fsPromises, 'mkdir');
  const mockWriteFile = vi.spyOn(fsPromises, 'writeFile');
  const mockRm = vi.spyOn(fs, 'rmSync');
  try {
    const username = 'user';
    const password = 'password';
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await new User({ username, password: hashedPassword }).save();
    const admin = await new User({ username: 'admin', password: hashedPassword, admin: true }).save();

    const name = 'GEMA';
    const version = '0.0.0';
    const description = `LPS de GEMA. Incluye tanto la interfaz de 
        especificación como el código fuente de la plataforma, 
        así como especificaciones de productos varios.`;

    mockMk.mockReset();
    mockWriteFile.mockReset();

    const mockGetProjectMembers = vi.spyOn(GitLabSession.prototype, 'getProjectMembers');
    mockGetProjectMembers.mockReturnValue(JSON.parse(getProjectMembersMock));

    const mockCreateGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateGroup.mockReturnValue(JSON.parse(createGroupMock));

    const mockCreateRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateRepository.mockReturnValue(JSON.parse(createRepositoryMock));

    const mockCreateFile = vi.spyOn(GitLabSession.prototype, 'createFile');
    mockCreateFile.mockReturnValue(JSON.parse(createFileMock));

    const line = await lineService.createLine({name, version, description, userId: user._id});

    const productData = {
        spec: {
          basicData: {
            name: 'SampleProduct',
            version: '0.0.0',
            database: { url: 'mongodb://localhost:27017'},
            languages: [ 'en', 'es', 'gl' ],
          },
          dataModel: { cells: [] },
          features: [
            "GEMA_SPL",
            "DataManagement",
            "GraphicalUserInterface",
            "MapViewer",
            "Tools",
            "DM_SpatialDatabase",
            "DM_GenerationType",
            "DM_DataServer",
            "MV_MapServer",
            "MV_Tools",
            "MV_MapManagement",
            "DM_SD_PostGIS",
            "MV_T_Pan",
            "MV_T_Zoom",
            "DM_GT_Identity",
            "MV_MS_GeoServer",
            "MV_MM_UniqueMapViewer",
            "MV_MM_UMV_MapCenter",
            "MV_MM_UMV_MC_BBox",
            "T_GIS"
          ],
          statics: []
        },
        lineId: line._id
      };

    const mockGetFile = vi.spyOn(GitLabSession.prototype, 'getFile');
    mockGetFile.mockReturnValue(JSON.parse(getFileMock));

    const mockCreateProductGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateProductGroup.mockReturnValue(JSON.parse(createGroupMock.replace(new RegExp(name, 'g'), productData.spec.basicData.name)));

    const mockCreateProductRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateProductRepository.mockReturnValue(JSON.parse(createRepositoryMock.replace(new RegExp(name, 'g'), productData.spec.basicData.name)));

    const mockCreateBranch = vi.spyOn(GitLabSession.prototype, 'createBranch');
    mockCreateBranch.mockReturnValue(createBranchMock);

    const mockSetDefaultBranch = vi.spyOn(GitLabSession.prototype, 'setDefaultBranch');
    mockSetDefaultBranch.mockReturnValue(createRepositoryMock);

    const mockDownloadRepositoryFile = vi.spyOn(GitLabProvider.prototype, 'downloadArchive');
    mockDownloadRepositoryFile.mockReset();

    mockRm.mockReset();
    
    const product = await productService.createProduct({...productData, userId: user._id});

    const foundProduct = await productService.findProductById({ id: product._id, userId: admin._id });

    expect(foundProduct.spec).toMatchObject(productData.spec);
  } finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
    mockRm.mockRestore();
  }
});

test('Product conflicts count the MRs of both relevant branches with one call, and per branch when a page is full', async () => {
  const mockMk = vi.spyOn(fsPromises, 'mkdir');
  const mockWriteFile = vi.spyOn(fsPromises, 'writeFile');
  const mockRm = vi.spyOn(fs, 'rmSync');
  try {
    const username = 'user';
    const password = 'password';
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await new User({ username, password: hashedPassword }).save();

    const name = 'GEMA';
    const version = '0.0.0';
    const description = `LPS de GEMA. Incluye tanto la interfaz de
        especificación como el código fuente de la plataforma,
        así como especificaciones de productos varios.`;

    mockMk.mockReset();
    mockWriteFile.mockReset();

    const mockGetProjectMembers = vi.spyOn(GitLabSession.prototype, 'getProjectMembers');
    mockGetProjectMembers.mockReturnValue(JSON.parse(getProjectMembersMock));

    const mockCreateGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateGroup.mockReturnValue(JSON.parse(createGroupMock));

    const mockCreateRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateRepository.mockReturnValue(JSON.parse(createRepositoryMock));

    const mockCreateFile = vi.spyOn(GitLabSession.prototype, 'createFile');
    mockCreateFile.mockReturnValue(JSON.parse(createFileMock));

    const line = await lineService.createLine({name, version, description, userId: user._id});

    const productData = {
        spec: {
          basicData: {
            name: 'SampleProduct',
            version: '0.0.0',
            database: { url: 'mongodb://localhost:27017'},
            languages: [ 'en', 'es', 'gl' ],
          },
          dataModel: { cells: [] },
          features: [
            "GEMA_SPL",
            "DataManagement",
            "GraphicalUserInterface",
            "MapViewer",
            "Tools",
            "DM_SpatialDatabase",
            "DM_GenerationType",
            "DM_DataServer",
            "MV_MapServer",
            "MV_Tools",
            "MV_MapManagement",
            "DM_SD_PostGIS",
            "MV_T_Pan",
            "MV_T_Zoom",
            "DM_GT_Identity",
            "MV_MS_GeoServer",
            "MV_MM_UniqueMapViewer",
            "MV_MM_UMV_MapCenter",
            "MV_MM_UMV_MC_BBox",
            "T_GIS"
          ],
          statics: []
        },
        lineId: line._id
      };

    const mockGetFile = vi.spyOn(GitLabSession.prototype, 'getFile');
    mockGetFile.mockReturnValue(JSON.parse(getFileMock));

    const mockCreateProductGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateProductGroup.mockReturnValue(JSON.parse(createGroupMock.replace(new RegExp(name, 'g'), productData.spec.basicData.name)));

    const mockCreateProductRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateProductRepository.mockReturnValue(JSON.parse(createRepositoryMock.replace(new RegExp(name, 'g'), productData.spec.basicData.name)));

    const mockCreateBranch = vi.spyOn(GitLabSession.prototype, 'createBranch');
    mockCreateBranch.mockReturnValue(createBranchMock);

    const mockSetDefaultBranch = vi.spyOn(GitLabSession.prototype, 'setDefaultBranch');
    mockSetDefaultBranch.mockReturnValue(createRepositoryMock);

    const product = await productService.createProduct({...productData, userId: user._id});

    // One MR only on baseBranch (bigbang), one only on defaultBranch (main), and
    // one shared iid returned by both (simulating the same MR echoed by a lax
    // mock/gateway) that must not be double-counted.
    const bigbangMR = { number: 101, hasConflicts: true, targetBranch: properties.git.baseBranch };
    const mainMR = { number: 102, hasConflicts: false, targetBranch: properties.git.defaultBranch };
    const sharedMR = { number: 103, hasConflicts: true, targetBranch: 'shared' };

    const unrelatedMR = { number: 104, hasConflicts: true, targetBranch: 'unrelated' };
    let fullPage = false;
    const mockGetMergeRequests = vi.spyOn(GitLabProvider.prototype, 'listChangeRequests');
    mockGetMergeRequests.mockImplementation(({ targetBranch }) => {
      if (targetBranch === undefined) {
        // the answer of the host holds one page: a full one may have left MRs out
        return fullPage
          ? [bigbangMR, mainMR, sharedMR, ...Array.from({ length: 17 }, (_, i) => ({ number: 200 + i, hasConflicts: false, targetBranch: 'x' }))]
          : [bigbangMR, mainMR, unrelatedMR];
      }
      if (targetBranch === properties.git.baseBranch) return [bigbangMR, sharedMR];
      if (targetBranch === properties.git.defaultBranch) return [mainMR, sharedMR];
      throw new Error(`Unexpected targetBranch in test: ${targetBranch}`);
    });

    // One call without a branch: the MRs of other branches are told apart here, so they do not inflate the count.
    const conflicts = await productService.getProductConflicts({ id: product._id, userId: user._id });
    expect(mockGetMergeRequests).toHaveBeenCalledTimes(1);
    expect(conflicts.openMRs).toBe(2);
    expect(conflicts.conflictingMRs).toBe(1);
    expect(conflicts.firstConflictNumber).toBe(101);

    // A full page may have pushed the real conflict MR past the cutoff: each relevant branch is asked for on its own (its own page).
    fullPage = true;
    productService.forgetStatuses(product._id);
    const conflictsOfFullPage = await productService.getProductConflicts({ id: product._id, userId: user._id });
    expect(mockGetMergeRequests).toHaveBeenCalledTimes(4);
    expect(mockGetMergeRequests.mock.calls.slice(2).map(([arg]) => arg.targetBranch).sort()).toEqual(
      [properties.git.baseBranch, properties.git.defaultBranch].sort()
    );
    // 3 distinct MRs (101, 102, 103), not 4 � sharedMR must be deduped by iid; only bigbangMR and sharedMR have conflicts.
    expect(conflictsOfFullPage.openMRs).toBe(3);
    expect(conflictsOfFullPage.conflictingMRs).toBe(2);

    mockGetMergeRequests.mockRestore();
  } finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
    mockRm.mockRestore();
  }
});

// (generating a product end to end is tested against the git double in productGenerateDouble.test.js: the mocks of the old GitLab session do not reach the provider the generation uses)

// Vitest runs test files in parallel, and generateProduct/generateZip write
// into properties.paths.output under a uuid per run. Wiping that root
// from here deleted another file's derivation mid-flight (ENOENT on a source
// file it was still reading), so this file gets its own output root and only
// ever removes that. Same pattern as productServiceGenerateZip.test.js.
const originalOutput = properties.paths.output;
const fileOutput = path.join(originalOutput, 'productService.test');

beforeAll(() => {
  fs.mkdirSync(fileOutput, { recursive: true });
  properties.paths.output = fileOutput;
});
beforeAll(setup);
afterEach(clear);
afterAll(teardown);
afterAll(() => {
  properties.paths.output = originalOutput;
  fs.rmSync(fileOutput, { recursive: true, force: true });
});