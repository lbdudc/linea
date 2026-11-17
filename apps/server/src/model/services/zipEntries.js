import JSZip from 'jszip';

/** The file names inside a zip (a Buffer), read from its central directory: no zip library needed to list them. */
export const zipEntries = (buffer) => {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) return [];
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const names = [];
  for (let n = 0; n < count && at + 46 <= buffer.length && buffer.readUInt32LE(at) === 0x02014b50; n++) {
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    if (!name.endsWith('/')) names.push(name);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names.sort();
};

const MAX_CONTENT = 1024 * 1024;

/** What some files of a zip hold, as text: `{ path: text }`. A file that is missing, bigger than 1 MB or not text is left out. */
export const zipContents = async (buffer, paths) => {
  const archive = await JSZip.loadAsync(buffer);
  const out = {};
  for (const path of paths) {
    const entry = archive.file(path);
    if (!entry) continue;
    const bytes = await entry.async('nodebuffer');
    if (bytes.length > MAX_CONTENT || bytes.includes(0)) continue;
    out[path] = bytes.toString('utf8');
  }
  return out;
};
