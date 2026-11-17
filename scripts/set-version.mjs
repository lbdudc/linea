#!/usr/bin/env node
// Sets the version of every published package to the one of a release tag (`v1.2.3` or `1.2.3`, with a prerelease like `-rc.1` if any),
// and makes the packages that depend on each other ask for that version. Run in CI before publishing; nothing is committed.
//   node scripts/set-version.mjs v1.2.3
import fs from 'node:fs';

const tag = process.argv[2] ?? '';
const version = tag.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`"${tag}" is not a version tag (vX.Y.Z or vX.Y.Z-rc.1)`);
  process.exit(1);
}

const PACKAGES = ['core', 'git', 'cli', 'ci', 'sdk'];
const names = new Set(PACKAGES.map((dir) => JSON.parse(fs.readFileSync(`packages/${dir}/package.json`, 'utf8')).name));
for (const dir of PACKAGES) {
  const file = `packages/${dir}/package.json`;
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.version = version;
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const name of Object.keys(pkg[field] ?? {})) if (names.has(name)) pkg[field][name] = `^${version}`;
  }
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${pkg.name}@${version}`);
}
