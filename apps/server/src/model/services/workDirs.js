import fs from 'node:fs';
import path from 'node:path';

const STALE_MS = 24 * 60 * 60 * 1000;

export const removeWorkDir = (dir) => {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    console.error(`[workDirs] could not remove ${dir}:`, error?.message ?? error);
  }
};

export const pruneWorkDirs = (root, { maxAgeMs = STALE_MS, now = Date.now() } = {}) => {
  fs.mkdirSync(root, { recursive: true });
  for (const entry of fs.readdirSync(root)) {
    const dir = path.join(root, entry);
    try {
      if (now - fs.statSync(dir).mtimeMs > maxAgeMs) removeWorkDir(dir);
    } catch (error) {
      console.error(`[workDirs] could not check ${dir}:`, error?.message ?? error);
    }
  }
};
