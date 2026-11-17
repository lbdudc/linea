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
const onHost = (repoId, name, createdAt) => ({ id: repoId, name, namespaceId: repoId, webUrl: `https://gitlab.example/${name}`, webIdeUrl: '', topics: ['spl'], createdAt });

beforeEach(() => {
  clearReadCache();
  stubModular();
  vi.spyOn(GitLabProvider.prototype, 'readFile').mockResolvedValue(null);
});

test('a line found on the host takes the date of its repository, not the day it was found', async () => {
  vi.spyOn(GitLabProvider.prototype, 'listRepositories').mockResolvedValue([onHost(301, 'Found', '2024-03-05T10:00:00.000Z')]);
  const user = await seedUser();

  const [line] = await lineService.findEnrolledLines({ userId: user._id });

  expect(line.createdAt.toISOString()).toBe('2024-03-05T10:00:00.000Z');
});

test('a line dated the day it was found is corrected, and stays so', async () => {
  const stored = await new Line({ name: 'Imported', version: '1.0.0', repoId: 302, namespaceId: 302, createdAt: new Date('2026-11-02T09:37:24.000Z') }).save();
  vi.spyOn(GitLabProvider.prototype, 'listRepositories').mockResolvedValue([onHost(302, 'Imported', '2024-03-05T10:00:00.000Z')]);
  const user = await seedUser();

  const [line] = await lineService.findEnrolledLines({ userId: user._id });

  expect(line.createdAt.toISOString()).toBe('2024-03-05T10:00:00.000Z');
  expect((await Line.findById(stored._id)).createdAt.toISOString()).toBe('2024-03-05T10:00:00.000Z');
});

test('a line made here keeps its own date when the repository was made seconds apart', async () => {
  const stored = await new Line({ name: 'MadeHere', version: '1.0.0', repoId: 303, namespaceId: 303, createdAt: new Date('2026-11-05T15:12:38.000Z') }).save();
  vi.spyOn(GitLabProvider.prototype, 'listRepositories').mockResolvedValue([onHost(303, 'MadeHere', '2026-11-05T15:12:40.000Z')]);
  const user = await seedUser();

  await lineService.findEnrolledLines({ userId: user._id });

  expect((await Line.findById(stored._id)).createdAt.toISOString()).toBe('2026-11-05T15:12:38.000Z');
});

test('a host that does not say when it made a repository leaves the date as it is', async () => {
  const stored = await new Line({ name: 'NoDate', version: '1.0.0', repoId: 304, namespaceId: 304, createdAt: new Date('2026-11-02T09:37:24.000Z') }).save();
  vi.spyOn(GitLabProvider.prototype, 'listRepositories').mockResolvedValue([onHost(304, 'NoDate', undefined)]);
  const user = await seedUser();

  await lineService.findEnrolledLines({ userId: user._id });

  expect((await Line.findById(stored._id)).createdAt.toISOString()).toBe('2026-11-02T09:37:24.000Z');
});

beforeAll(setup);
afterEach(clear);
afterAll(teardown);
