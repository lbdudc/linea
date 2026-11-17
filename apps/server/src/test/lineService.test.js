import User from '../model/entities/user.js';
import { AlreadyExistentLineError, PermissionError } from '../model/errors/errors.js';
import { createGroupMock, createRepositoryMock, deleteGroupMock, createFileMock, getProjectsMock, getProjectMembersMock } from './mocks/index.js';
import bcrypt from 'bcrypt';
import { setup, clear, teardown } from './setup.js';
import { vi, test, expect, afterEach, beforeAll, beforeEach, afterAll } from "vitest";
import Product from '../model/entities/product.js';
import Line from '../model/entities/line.js';
import { GitLabSession } from "gitlab-commando";
import { GitLabProvider } from '@lbdudc/linea-git';
import { repositoryOfGitLabProject, stubBranchesAndTags } from './support/gitStubs.js';
import fsPromises from 'fs/promises';
import LineService from '../model/services/LineService.js';
import { Container } from 'typedi';
import ProductSpecService, { ProductSpecUnavailableError } from '../model/services/ProductSpecService.js';
import { stubModular, scaffoldOf, EMPTY_LOCK } from './support/stubModular.js';
import { serializeLock, serializeProductsIndex, emptyProductsIndex } from '@lbdudc/linea-core';


const lineService = Container.get(LineService);

// the git host is not there unless a test says what it answers (a call that reached the real one would fail the file)
beforeEach(() => {
  vi.spyOn(GitLabProvider.prototype, 'listRepositories').mockRejectedValue(new Error('the git host is not available in this test'));
  // the versions a line keeps are tags: they are kept in memory
  stubBranchesAndTags();
  // there is no registry to resolve the feature metamodel from: what a line is made of is the scaffold of its kind
  stubModular();
});

test('Create software product line successfully', async () => {
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

    const mockCreateGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateGroup.mockReturnValue(JSON.parse(createGroupMock));

    const mockCreateRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateRepository.mockReturnValue(JSON.parse(createRepositoryMock));

    const mockCreateFile = vi.spyOn(GitLabSession.prototype, 'createFile');
    mockCreateFile.mockReturnValue(JSON.parse(createFileMock));

    const line = await lineService.createLine({name, version, description, userId: user._id});

    expect(line.name).toBe(name);
    expect(line.version).toBe(version);
    expect(line.description).toBe(description);

    const expected = [
      ...scaffoldOf({ name, kind: 'plain' }),
      { path: 'linea.lock.json', content: serializeLock({ lock: EMPTY_LOCK }) },
      { path: 'products.json', content: serializeProductsIndex({ index: emptyProductsIndex() }) },
    ].map((f) => [undefined, 1656, f.path, 'main', f.content]);
    expect(mockCreateFile.mock.calls).toEqual(expected);
    // every line has its manifest and its feature model, and none has the UVL file of before
    const paths = mockCreateFile.mock.calls.map((c) => c[2]);
    expect(paths).toContain('spl.json');
    expect(paths).toContain('models/featuremodel.featuremodel');
    expect(paths).not.toContain('src/platform/model.uvl');
    } finally {
        mockMk.mockRestore();
        mockWriteFile.mockRestore();
      }

});

test('Create already existent software product line', async () => {
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

    const mockCreateGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateGroup.mockReturnValue(JSON.parse(createGroupMock));

    const mockCreateRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateRepository.mockReturnValue(JSON.parse(createRepositoryMock));

    const mockCreateFile = vi.spyOn(GitLabSession.prototype, 'createFile');
    mockCreateFile.mockReturnValue(JSON.parse(createFileMock));

    await lineService.createLine({name, version, description, userId: user._id});
    await expect(() => lineService.createLine({name, version, description, userId: user._id})).rejects.toThrow(AlreadyExistentLineError);
} finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
  }
});

test('Find all enrolled software product lines', async () => {
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
    const name2 = 'Plagemis';
    const description2 = `LPS de Plagemis. Incluye tanto la interfaz de 
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

    await lineService.createLine({name, version, description, userId: user._id});

    const mockCreateGroup2 = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateGroup2.mockReturnValue(JSON.parse(createGroupMock.replace(new RegExp(name, 'g'), name2)));

    const mockCreateRepository2 = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateRepository2.mockReturnValue(JSON.parse(createRepositoryMock
        .replace(new RegExp(name, 'g'), name2).replace(/1656/g, '1657')));

    await lineService.createLine({name: name2, version, description: description2, userId: user._id});

    vi.spyOn(GitLabProvider.prototype, 'listRepositories').mockResolvedValue(JSON.parse(getProjectsMock).map(repositoryOfGitLabProject));

    const lineList = await lineService.findEnrolledLines({ userId: user._id });

    expect(lineList.length).toBe(2);
    expect(lineList.filter(l => l.name === name).length).toBe(1);
    expect(lineList.filter(l => l.name === name2).length).toBe(1);
} finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
  }
});

test('Delete a software product line successfully', async () => {
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

    const mockCreateGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateGroup.mockReturnValue(JSON.parse(createGroupMock));

    const mockCreateRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateRepository.mockReturnValue(JSON.parse(createRepositoryMock));

    const mockCreateFile = vi.spyOn(GitLabSession.prototype, 'createFile');
    mockCreateFile.mockReturnValue(JSON.parse(createFileMock));

    const line = await lineService.createLine({name, version, description, userId: user._id});

    const mockGetProjectMembers = vi.spyOn(GitLabSession.prototype, 'getProjectMembers');
    mockGetProjectMembers.mockReturnValue(JSON.parse(getProjectMembersMock));

    const mockDeleteGroup = vi.spyOn(GitLabSession.prototype, 'deleteGroup');
    mockDeleteGroup.mockReturnValue(JSON.parse(deleteGroupMock));

    await lineService.deleteLine({ id: line._id, userId: user._id });

    const deleted = await Line.findById(line._id);

    expect(deleted).toBe(null);
} finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
  }
})

test('Delete a software product line without privileges', async () => {
    const mockMk = vi.spyOn(fsPromises, 'mkdir');
    const mockWriteFile = vi.spyOn(fsPromises, 'writeFile');
    try {
    const username = 'user';
    const username2 = 'user2'
    const password = 'password';
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await new User({ username, password: hashedPassword }).save();
    const user2 = await new User({ username: username2, password: hashedPassword }).save();

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

    const mockDeleteGroup = vi.spyOn(GitLabSession.prototype, 'deleteGroup');
    mockDeleteGroup.mockReturnValue(JSON.parse(deleteGroupMock));

    const mockGetProjectMembers = vi.spyOn(GitLabSession.prototype, 'getProjectMembers');
    mockGetProjectMembers.mockReturnValue(JSON.parse(getProjectMembersMock));

    await expect(() => lineService.deleteLine({ id: line._id, userId: user2._id })).rejects.toThrow(PermissionError);
} finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
  }
})

test('Delete a software product line with admin user', async () => {
    const mockMk = vi.spyOn(fsPromises, 'mkdir');
    const mockWriteFile = vi.spyOn(fsPromises, 'writeFile');
    try {
    const username = 'user';
    const adminname = 'admin'
    const password = 'password';
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await new User({ username, password: hashedPassword }).save();
    const admin = await new User({ username: adminname, password: hashedPassword, admin: true }).save();

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

    const mockGetProjectMembers = vi.spyOn(GitLabSession.prototype, 'getProjectMembers');
    mockGetProjectMembers.mockReturnValue(JSON.parse(getProjectMembersMock));

    const mockDeleteGroup = vi.spyOn(GitLabSession.prototype, 'deleteGroup');
    mockDeleteGroup.mockReturnValue(JSON.parse(deleteGroupMock));

    await lineService.deleteLine({ id: line._id, userId: admin._id });

    const deleted = await Line.findById(line._id);

    expect(deleted).toBe(null);

} finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
  }
})

test('Find software product line successfully', async () => {
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

    const mockCreateGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateGroup.mockReturnValue(JSON.parse(createGroupMock));

    const mockCreateRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateRepository.mockReturnValue(JSON.parse(createRepositoryMock));

    const mockCreateFile = vi.spyOn(GitLabSession.prototype, 'createFile');
    mockCreateFile.mockReturnValue(JSON.parse(createFileMock));

    const line = await lineService.createLine({name, version, description, userId: user._id});

    const mockGetProjectMembers = vi.spyOn(GitLabSession.prototype, 'getProjectMembers');
    mockGetProjectMembers.mockReturnValue(JSON.parse(getProjectMembersMock));

    const foundLine = await lineService.findLineById({id: line._id, userId: user._id});

    expect(foundLine.name).toBe(line.name);
    expect(foundLine.version).toBe(line.version);
    expect(foundLine.description).toBe(line.description);

} finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
  }
});

test('Find products associated to a software product line successfully', async () => {
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

    const mockCreateGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateGroup.mockReturnValue(JSON.parse(createGroupMock));

    const mockCreateRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateRepository.mockReturnValue(JSON.parse(createRepositoryMock));

    const mockCreateFile = vi.spyOn(GitLabSession.prototype, 'createFile');
    mockCreateFile.mockReturnValue(JSON.parse(createFileMock));

    const line = await lineService.createLine({name, version, description, userId: user._id});
    const products = await Product.find({ lineId: line._id });

    const mockGetProjectMembers = vi.spyOn(GitLabSession.prototype, 'getProjectMembers');
    mockGetProjectMembers.mockReturnValue(JSON.parse(getProjectMembersMock));

    const foundProducts = await lineService.findProductsByLineId({id: line._id, userId: user._id});

    expect(foundProducts.length).toBe(products.length);

} finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
  }
});

test('Find products count associated to a software product line successfully', async () => {
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

    const mockCreateGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateGroup.mockReturnValue(JSON.parse(createGroupMock));

    const mockCreateRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateRepository.mockReturnValue(JSON.parse(createRepositoryMock));

    const mockCreateFile = vi.spyOn(GitLabSession.prototype, 'createFile');
    mockCreateFile.mockReturnValue(JSON.parse(createFileMock));

    const line = await lineService.createLine({name, version, description, userId: user._id});
    const products = await Product.find({ lineId: line._id });

    const mockGetProjectMembers = vi.spyOn(GitLabSession.prototype, 'getProjectMembers');
    mockGetProjectMembers.mockReturnValue(JSON.parse(getProjectMembersMock));

    const foundProductsCount = await lineService.findProductsCountByLineId({id: line._id, userId: user._id});

    expect(foundProductsCount).toBe(products.length);

} finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
  }
});

test('Find software product line without privileges', async () => {
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

    const mockCreateGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateGroup.mockReturnValue(JSON.parse(createGroupMock));

    const mockCreateRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateRepository.mockReturnValue(JSON.parse(createRepositoryMock));

    const mockCreateFile = vi.spyOn(GitLabSession.prototype, 'createFile');
    mockCreateFile.mockReturnValue(JSON.parse(createFileMock));

    const line = await lineService.createLine({name, version, description, userId: user._id});

    const mockGetProjectMembers = vi.spyOn(GitLabSession.prototype, 'getProjectMembers');
    mockGetProjectMembers.mockReturnValue(JSON.parse(getProjectMembersMock));

    await expect(() => lineService.findLineById({ id: line._id, userId: user2._id })).rejects.toThrow(PermissionError);

} finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
  }
});

test('Find software product line with admin user', async () => {
    const mockMk = vi.spyOn(fsPromises, 'mkdir');
    const mockWriteFile = vi.spyOn(fsPromises, 'writeFile');
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

    const mockCreateGroup = vi.spyOn(GitLabSession.prototype, 'createGroup');
    mockCreateGroup.mockReturnValue(JSON.parse(createGroupMock));

    const mockCreateRepository = vi.spyOn(GitLabSession.prototype, 'createProject');
    mockCreateRepository.mockReturnValue(JSON.parse(createRepositoryMock));

    const mockCreateFile = vi.spyOn(GitLabSession.prototype, 'createFile');
    mockCreateFile.mockReturnValue(JSON.parse(createFileMock));

    const line = await lineService.createLine({name, version, description, userId: user._id});

    const mockGetProjectMembers = vi.spyOn(GitLabSession.prototype, 'getProjectMembers');
    mockGetProjectMembers.mockReturnValue(JSON.parse(getProjectMembersMock));

    const foundLine = await lineService.findLineById({id: line._id, userId: admin._id});

    expect(foundLine.name).toBe(line.name);
    expect(foundLine.version).toBe(line.version);
    expect(foundLine.description).toBe(line.description);
} finally {
    mockMk.mockRestore();
    mockWriteFile.mockRestore();
  }
});

test('findProductsByLineId({ cutOnInfra: true }) aborts when a product spec cannot be read from GitLab', async () => {
  const hashedPassword = await bcrypt.hash('password', 10);
  const user = await new User({ username: `cutinfra-${Date.now()}`, password: hashedPassword, admin: true }).save();

  const line = await new Line({
    name: 'CutOnInfraLine', version: '0.0.0', description: 'x',
    repoId: 4321, namespaceId: 1, webUrl: 'http://example/x', ownerId: user._id,
  }).save();

  await new Product({
    spec: { basicData: { name: 'CutOnInfraProduct', version: '0.1.0' }, features: [] },
    lineId: line._id,
    repo: { id: 9876, namespaceId: 1, webUrl: 'http://example/x/p' },
  }).save();

  vi.spyOn(GitLabSession.prototype, 'getProjectMembers').mockReturnValue(JSON.parse(getProjectMembersMock));

  const productSpecService = Container.get(ProductSpecService);
  vi.spyOn(productSpecService, 'readSpec')
    .mockRejectedValue(Object.assign(new Error('502 Bad Gateway'), { status: 502 }));

  await expect(
    lineService.findProductsByLineId({ id: line._id, userId: user._id, specFromRepo: true, cutOnInfra: true })
  ).rejects.toThrow(ProductSpecUnavailableError);

  const products = await lineService.findProductsByLineId({ id: line._id, userId: user._id, specFromRepo: true });
  expect(products).toHaveLength(1);
  expect(products[0].spec.basicData.name).toBe('CutOnInfraProduct');
});

beforeAll(setup);
afterEach(clear);
afterAll(teardown);