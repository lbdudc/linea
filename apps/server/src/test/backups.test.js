import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setup, clear, teardown } from './setup.js';
import { backups, backupDir } from '../model/services/BackupService.js';
import { configureInstance } from '../config/instanceSettings.js';
import User from '../model/entities/user.js';

let dir;
beforeAll(async () => {
  await setup();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-backups-'));
  process.env.LINEA_BACKUP_DIR = dir;
});
afterEach(async () => { await clear(); await configureInstance({}); fs.rmSync(dir, { recursive: true, force: true }); });
afterAll(async () => { delete process.env.LINEA_BACKUP_DIR; await teardown(); });

test('keeps every collection in a file only its owner reads, and says what is in it against what there is now', async () => {
  await User.create({ username: 'ana' });
  const made = await backups.run({ now: new Date('2026-11-18T10:00:00Z') });
  expect(made.name).toBe('linea-backup-20261118T100000Z.json.gz');
  expect(made.collections.users).toBe(1);
  expect(fs.statSync(path.join(backupDir(), made.name)).mode & 0o077).toBe(0);
  await User.create({ username: 'bea' });
  const preview = await backups.preview(made.name);
  expect(preview.collections.find((row) => row.collection === 'users')).toEqual({ collection: 'users', backup: 1, now: 2 });
});

test('keeps as many as it is told and forgets the oldest', async () => {
  await configureInstance({ file: { backupKeep: 2 } });
  for (const day of ['16', '17', '18']) await backups.run({ now: new Date(`2026-11-${day}T10:00:00Z`) });
  expect((await backups.list()).map((entry) => entry.name)).toEqual(['linea-backup-20261118T100000Z.json.gz', 'linea-backup-20261117T100000Z.json.gz']);
});

test('is due only when switched on and the last one is older than the period', async () => {
  const now = new Date('2026-11-18T12:00:00Z');
  expect(await backups.due({ now })).toBe(false);
  await configureInstance({ file: { backupEveryHours: 6 } });
  expect(await backups.due({ now })).toBe(true);
  const fresh = await backups.run({ now });
  fs.utimesSync(path.join(dir, fresh.name), now, now);
  expect(await backups.due({ now: new Date('2026-11-18T14:00:00Z') })).toBe(false);
  expect(await backups.due({ now: new Date('2026-11-18T19:00:00Z') })).toBe(true);
});

test('gives no file for a name that is not one of its own', () => {
  expect(backups.fileOf('../../etc/passwd')).toBeNull();
  expect(backups.fileOf('linea-backup-20261118T100000Z.json.gz')).toBeNull();
});
