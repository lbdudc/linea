import bcrypt from 'bcrypt';
import { test, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { Container } from 'typedi';
import { GitLabProvider, clearReadCache } from '@lbdudc/linea-git';
import User from '../model/entities/user.js';
import Line from '../model/entities/line.js';
import Product from '../model/entities/product.js';
import LineService from '../model/services/LineService.js';
import { setup, clear, teardown } from './setup.js';

const lineService = Container.get(LineService);

const seedUser = async () => new User({ username: `user-${Math.random()}`, password: await bcrypt.hash('password', 10) }).save();

const pending = (id, name, namespaceId, parentNamespaceId, deletesOn = null) => ({
  id, name, path: `group/${name}`, webUrl: `https://gitlab.example/group-deletion_scheduled-1/${name}`, namespaceId, parentNamespaceId, deletesOn,
});

const onHost = ({ lines = [], products = [] }) => vi.spyOn(GitLabProvider.prototype, 'listPendingDeletion')
  .mockImplementation(async ({ topic }) => (topic === 'spl' ? lines : products));

beforeEach(() => {
  clearReadCache();
  vi.spyOn(GitLabProvider.prototype, 'readFile').mockResolvedValue(null);
  vi.spyOn(lineService.productSpecService, 'readSpec').mockResolvedValue(null);
});

test('the inactive lines come from the host, with the day it deletes them, their repository and how many products wait with them', async () => {
  onHost({
    lines: [pending(7, 'Dated', 70, 1, '2026-11-08'), pending(8, 'Undated', 80, 1)],
    products: [pending(71, 'One', 710, 70), pending(72, 'Two', 720, 70)],
  });
  const user = await seedUser();

  const inactive = await lineService.findInactiveLines({ userId: user._id });

  expect(inactive).toMatchObject([
    { repoId: 7, name: 'Dated', path: 'group/Dated', webUrl: 'https://gitlab.example/group-deletion_scheduled-1/Dated', deletesOn: '2026-11-08', productCount: 2 },
    { repoId: 8, name: 'Undated', deletesOn: null, productCount: 0 },
  ]);
});

test('an inactive line LINEA still knows shows what LINEA knows of it, and the date its repository was made', async () => {
  await new Line({ name: 'Known', kind: 'modular', version: '2.3.0', repoId: 7, namespaceId: 70, createdAt: new Date('2026-01-01T00:00:00.000Z') }).save();
  onHost({ lines: [{ ...pending(7, 'Known', 70, 1), createdAt: '2024-03-05T10:00:00.000Z' }] });
  const user = await seedUser();

  const [line] = await lineService.findInactiveLines({ userId: user._id });

  expect(line).toMatchObject({ kind: 'modular', version: '2.3.0', createdAt: '2024-03-05T10:00:00.000Z' });
});

test('an inactive line LINEA has forgotten shows what its repository says', async () => {
  onHost({ lines: [{ ...pending(7, 'Forgotten', 70, 1), createdAt: '2024-03-05T10:00:00.000Z' }] });
  vi.spyOn(GitLabProvider.prototype, 'readFile').mockResolvedValue(Buffer.from(JSON.stringify({ name: 'forgotten', version: '1.4.0', kind: 'project', metamodels: {}, modules: {} })));
  const user = await seedUser();

  const [line] = await lineService.findInactiveLines({ userId: user._id });

  expect(line).toMatchObject({ kind: 'project', version: '1.4.0', createdAt: '2024-03-05T10:00:00.000Z' });
});

test('an inactive line whose repository cannot be read is still listed, plain and with no version', async () => {
  onHost({ lines: [pending(7, 'Unreadable', 70, 1)] });
  vi.spyOn(GitLabProvider.prototype, 'readFile').mockRejectedValue(new Error('boom'));
  const user = await seedUser();

  const [line] = await lineService.findInactiveLines({ userId: user._id });

  expect(line).toMatchObject({ name: 'Unreadable', kind: 'plain', version: null, createdAt: null });
});

test('an inactive product LINEA still knows shows its version and the date its repository was made', async () => {
  const line = await new Line({ name: 'Known', version: '1.0.0', repoId: 9, namespaceId: 90 }).save();
  await new Product({ lineId: line._id, spec: { basicData: { name: 'Known', version: '0.4.0', createdAt: new Date('2026-01-01T00:00:00.000Z') } }, repo: { id: 91, namespaceId: 910 } }).save();
  onHost({ products: [{ ...pending(91, 'Known', 910, 90), createdAt: '2024-03-05T10:00:00.000Z' }] });
  const readSpec = vi.spyOn(lineService.productSpecService, 'readSpec');
  const user = await seedUser();

  const [product] = await lineService.findInactiveProducts({ userId: user._id });

  expect(product).toMatchObject({ version: '0.4.0', createdAt: '2024-03-05T10:00:00.000Z' });
  expect(readSpec).not.toHaveBeenCalled();
});

test('an inactive product LINEA has forgotten shows what its repository says', async () => {
  onHost({ products: [{ ...pending(91, 'Forgotten', 910, 90), createdAt: '2024-03-05T10:00:00.000Z' }] });
  vi.spyOn(lineService.productSpecService, 'readSpec').mockResolvedValue({ basicData: { name: 'Forgotten', version: '0.7.0' } });
  const user = await seedUser();

  const [product] = await lineService.findInactiveProducts({ userId: user._id });

  expect(product).toMatchObject({ version: '0.7.0', createdAt: '2024-03-05T10:00:00.000Z' });
});

test('an inactive product whose repository cannot be read is still listed, with no version', async () => {
  onHost({ products: [pending(91, 'Unreadable', 910, 90)] });
  vi.spyOn(lineService.productSpecService, 'readSpec').mockRejectedValue(new Error('boom'));
  const user = await seedUser();

  const [product] = await lineService.findInactiveProducts({ userId: user._id });

  expect(product).toMatchObject({ name: 'Unreadable', version: null, createdAt: null });
});

test('listing the inactive lines does not read what only the inactive products show, nor the other way round', async () => {
  onHost({ lines: [pending(7, 'Line', 70, 1)], products: [pending(71, 'Product', 710, 70)] });
  const readSpec = vi.spyOn(lineService.productSpecService, 'readSpec');
  const readFile = GitLabProvider.prototype.readFile;
  const user = await seedUser();

  await lineService.findInactiveLines({ userId: user._id });
  expect(readSpec).not.toHaveBeenCalled();
  expect(readFile).toHaveBeenCalledTimes(1);

  readFile.mockClear();
  await lineService.findInactiveProducts({ userId: user._id });
  expect(readSpec).toHaveBeenCalledTimes(1);
  expect(readFile).not.toHaveBeenCalled();
});

test('an inactive product says which line it belongs to, whether that line waits to be deleted too, is still active or is unknown', async () => {
  await new Line({ name: 'ActiveLine', version: '1.0.0', repoId: 9, namespaceId: 90 }).save();
  onHost({
    lines: [pending(7, 'InactiveLine', 70, 1)],
    products: [pending(71, 'OfInactive', 710, 70, '2026-11-08'), pending(91, 'OfActive', 910, 90), pending(99, 'OfUnknown', 990, 12345)],
  });
  const user = await seedUser();

  const inactive = await lineService.findInactiveProducts({ userId: user._id });

  expect(inactive).toMatchObject([
    { repoId: 71, name: 'OfInactive', line: 'InactiveLine', deletesOn: '2026-11-08' },
    { repoId: 91, name: 'OfActive', line: 'ActiveLine', deletesOn: null },
    { repoId: 99, name: 'OfUnknown', line: null },
  ]);
});

beforeAll(setup);
afterEach(clear);
afterAll(teardown);
