import fs from 'node:fs';
import path from 'node:path';
import { structuredPatch } from 'diff';

const FILE_LIMIT = 300;
const TOTAL_BYTES = 400_000;
const FILE_BYTES = 40_000;

const render = (patch) => patch.hunks.map((hunk) => [
  `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
  ...hunk.lines,
].join('\n')).join('\n');

const readOld = (oldDir, file) => {
  try {
    return fs.readFileSync(path.join(oldDir, ...String(file).split('/')), 'utf8');
  } catch {
    return '';
  }
};

/**
 * What a generation would change, as the page lists it: the first files with their action and, for text files, the unified diff against
 * the code that is in the repository. The diffs share a size budget; a file that does not fit (or is binary) has `diff: null`.
 */
export const describeChanges = ({ actions, oldDir }) => {
  const counts = { create: 0, update: 0, delete: 0 };
  for (const action of actions) counts[action.action] = (counts[action.action] ?? 0) + 1;
  let budget = TOTAL_BYTES;
  const files = actions.slice(0, FILE_LIMIT).map((action) => {
    const file = { path: action.file_path, action: action.action, diff: null, added: 0, removed: 0 };
    if (action.encoding === 'base64') return file;
    const before = action.action === 'create' ? '' : readOld(oldDir, action.file_path);
    const after = action.action === 'delete' ? '' : String(action.content ?? '');
    const patch = structuredPatch(action.file_path, action.file_path, before, after, '', '', { context: 3 });
    for (const hunk of patch.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) file.added += 1;
        else if (line.startsWith('-')) file.removed += 1;
      }
    }
    const text = render(patch);
    if (text.length <= FILE_BYTES && text.length <= budget) {
      file.diff = text;
      budget -= text.length;
    }
    return file;
  });
  return { counts, files, truncated: actions.length > FILE_LIMIT };
};
