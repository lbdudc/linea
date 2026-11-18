import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import { instance } from '../../config/instanceSettings.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const NAME = /^linea-backup-\d{8}T\d{6}Z\.json\.gz$/;
const CHECK_MS = 10 * 60_000;
const HOUR_MS = 3600_000;
const { EJSON } = mongoose.mongo.BSON;

export const backupDir = () => path.resolve(process.env.LINEA_BACKUP_DIR || 'backups');

const stamp = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/**
 * Backups of the database: every collection in one compressed file, in the folder LINEA_BACKUP_DIR (default `./backups`), kept as many as
 * `backupKeep` says; with `backupEveryHours` above 0 a new one is made whenever the last is older than that. The file has what the database
 * has, sessions and git tokens included, so it is readable by its owner only. The repositories are the git hosts' own and are not in it.
 */
export default class BackupService {
  #timer = null;
  #running = false;

  list = async () => {
    const dir = backupDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((file) => NAME.test(file)).map((name) => {
      const { size, mtime } = fs.statSync(path.join(dir, name));
      return { name, size, at: mtime };
    }).sort((a, b) => b.name.localeCompare(a.name));
  };

  run = async ({ now = new Date() } = {}) => {
    if (this.#running) throw Object.assign(new Error('a backup is already running'), { status: 409 });
    this.#running = true;
    try {
      const dir = backupDir();
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const collections = {};
      for (const { name } of await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()) {
        if (name.startsWith('system.')) continue;
        collections[name] = await mongoose.connection.db.collection(name).find({}).toArray();
      }
      const body = await gzip(Buffer.from(EJSON.stringify({ version: 1, at: now.toISOString(), collections }, { relaxed: false })));
      const name = `linea-backup-${stamp(now)}.json.gz`;
      const file = path.join(dir, name);
      fs.writeFileSync(`${file}.tmp`, body, { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
      this.#prune();
      return { name, size: body.length, at: now, collections: Object.fromEntries(Object.entries(collections).map(([key, docs]) => [key, docs.length])) };
    } finally {
      this.#running = false;
    }
  };

  #prune = () => {
    const dir = backupDir();
    const names = fs.readdirSync(dir).filter((file) => NAME.test(file)).sort().reverse();
    for (const name of names.slice(Math.max(1, instance('backupKeep')))) fs.rmSync(path.join(dir, name), { force: true });
  };

  fileOf = (name) => {
    if (!NAME.test(String(name))) return null;
    const file = path.join(backupDir(), name);
    return fs.existsSync(file) ? file : null;
  };

  /** What a backup holds against what the database has now, per collection: what restoring it would bring back (nothing is changed). */
  preview = async (name) => {
    const file = this.fileOf(name);
    if (!file) return null;
    const saved = EJSON.parse((await gunzip(fs.readFileSync(file))).toString('utf8'));
    const rows = [];
    for (const [collection, docs] of Object.entries(saved.collections ?? {})) {
      const now = await mongoose.connection.db.collection(collection).countDocuments({}).catch(() => 0);
      rows.push({ collection, backup: docs.length, now });
    }
    return { name, at: saved.at, collections: rows.sort((a, b) => a.collection.localeCompare(b.collection)) };
  };

  due = async ({ now = new Date() } = {}) => {
    const hours = instance('backupEveryHours');
    if (!hours) return false;
    const [last] = await this.list();
    return !last || now.getTime() - new Date(last.at).getTime() >= hours * HOUR_MS;
  };

  start = () => {
    if (this.#timer) return;
    this.#timer = setInterval(async () => {
      try {
        if (await this.due()) await this.run();
      } catch (error) {
        console.error('[backup] failed:', error?.message ?? error);
      }
    }, CHECK_MS);
    this.#timer.unref?.();
  };

  stop = () => {
    clearInterval(this.#timer);
    this.#timer = null;
  };
}

export const backups = new BackupService();
