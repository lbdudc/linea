import bcrypt from 'bcrypt';
import { test, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { Container } from 'typedi';
import { GitLabProvider, clearReadCache } from '@lbdudc/linea-git';
import User from '../model/entities/user.js';
import Line from '../model/entities/line.js';
import LineService from '../model/services/LineService.js';
import { stubModular } from './support/stubModular.js';
import { setup, clear, teardown } from './setup.js';

const lineService = Container.get(LineService);

const seedUser = async () => new User({ username: `user-${Math.random()}`, password: await bcrypt.hash('password', 10) }).save();
const onHost = (repoId, name) => ({ id: repoId, name, namespaceId: repoId, webUrl: `https://gitlab.example/${name}`, webIdeUrl: '', topics: ['spl'] });
const manifest = (name, kind) => Buffer.from(JSON.stringify({ name, version: '1.0.0', kind, metamodels: {}, modules: {} }));

beforeEach(() => {
  clearReadCache();
  stubModular();
});

test('a line found on the host takes the kind its spl.json says', async () => {
  vi.spyOn(GitLabProvider.prototype, 'listRepositories').mockResolvedValue([onHost(401, 'Modular')]);
  vi.spyOn(GitLabProvider.prototype, 'readFile').mockResolvedValue(manifest('Modular', 'modular'));
  const user = await seedUser();

  const [line] = await lineService.findEnrolledLines({ userId: user._id });

  expect(line.kind).toBe('modular');
});

test('a line whose spl.json cannot be read is left for a later listing, not taken for plain', async () => {
  vi.spyOn(GitLabProvider.prototype, 'listRepositories').mockResolvedValue([onHost(402, 'Unreadable')]);
  const read = vi.spyOn(GitLabProvider.prototype, 'readFile').mockRejectedValueOnce(new Error('timed out'));
  const user = await seedUser();

  expect(await lineService.findEnrolledLines({ userId: user._id })).toHaveLength(0);
  expect(await Line.findOne({ name: 'Unreadable' })).toBeNull();

  read.mockResolvedValue(manifest('Unreadable', 'project'));
  const [line] = await lineService.findEnrolledLines({ userId: user._id });

  expect(line.kind).toBe('project');
});

test('a line known by name that comes back in a new repository takes the kind of that repository', async () => {
  const stored = await new Line({ name: 'Again', version: '1.0.0', kind: 'plain', repoId: 403, namespaceId: 403 }).save();
  vi.spyOn(GitLabProvider.prototype, 'listRepositories').mockResolvedValue([onHost(404, 'Again')]);
  vi.spyOn(GitLabProvider.prototype, 'readFile').mockResolvedValue(manifest('Again', 'modular'));
  const user = await seedUser();

  const [line] = await lineService.findEnrolledLines({ userId: user._id });

  expect(String(line._id)).toBe(String(stored._id));
  expect(line.repoId).toBe(404);
  expect(line.kind).toBe('modular');
});

beforeAll(setup);
afterEach(clear);
afterAll(teardown);
