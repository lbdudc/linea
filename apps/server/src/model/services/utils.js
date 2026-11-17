import fsPromises from 'fs/promises';
import path from "path";
import dircompare from 'dir-compare';
import isBinaryPath from "is-binary-path";
import md5File from 'md5-file';

const isFileToDelete = diff => diff.state === "left" && diff.type1 === "file" && diff.name1 !== "README.md";

const isFileToCreate = diff => diff.state === "right" && diff.type2 === "file";

// Async so the MD5 hashing (and the directory walk in generateActions below)
// yields to the event loop instead of blocking it for the whole diff — a
// synchronous version of this stalled socket.io's heartbeat long enough to
// disconnect every connected client while generating larger products.
const isFileToUpdate = async diff => {
    if (diff.state !== "equal" || diff.type2 !== "file") return false;

    const [hash1, hash2] = await Promise.all([
        md5File(path.join(diff.path1, diff.name1)),
        md5File(path.join(diff.path2, diff.name2)),
    ]);

    return hash1 !== hash2;
}

// GitLab's commit API treats file_path as a POSIX path — on Windows, path.join
// produces backslashes, which GitLab silently accepts as a literal character in
// the filename instead of a separator, corrupting any nested path.
const toGitPath = (...segments) => path.join(...segments).split(path.sep).join('/');

const generateAction = async (diff, oldPath, newPath, isUpdate) => {
    if (isFileToDelete(diff)) {
        const relativePath = path.relative(oldPath, diff.path1);
      return {
            action: "delete",
            file_path: toGitPath(relativePath, diff.name1)
        };
    } else if (isFileToCreate(diff) || isUpdate) {
        const relativePath = path.relative(newPath, diff.path2);
        const isBinary = isBinaryPath(path.join(diff.path2, diff.name2));
        const content = await fsPromises.readFile(path.join(diff.path2, diff.name2), isBinary ? "base64" : "utf-8");
        const encoding = isBinary ? "base64" : "text";
        const actionType = isFileToCreate(diff) ? "create" : "update";
        return {
            action: actionType,
            file_path: toGitPath(relativePath, diff.name2),
            content,
            encoding
        };
    }
  }

export const generateActions = async (oldPath, newPath) => {
    const { diffSet } = await dircompare.compare(oldPath, newPath);

    const flagged = await Promise.all(diffSet.map(async diff => ({ diff, isUpdate: await isFileToUpdate(diff) })));

    return Promise.all(
        flagged
            .filter(({ diff, isUpdate }) => isFileToDelete(diff) || isFileToCreate(diff) || isUpdate)
            .map(({ diff, isUpdate }) => generateAction(diff, oldPath, newPath, isUpdate))
    );
};
