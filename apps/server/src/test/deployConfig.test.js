import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from 'vitest';
import { loadDeployConfig } from '../config/deployConfig.js';

const write = (text) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-')), 'linea.config.yml');
  fs.writeFileSync(file, text);
  return file;
};

test('no file is no declaration, unless the file was asked for', () => {
  expect(loadDeployConfig({ file: '/nowhere/linea.config.yml' }).declared).toEqual({});
  expect(() => loadDeployConfig({ file: '/nowhere/linea.config.yml', required: true })).toThrow(/does not exist/);
});

test('reads the plugins, expands the variables, and warns about what it ignores', () => {
  const file = write(`
gitHosts: { primary: gitlab }
plugins:
  analytics-plugin: { enabled: true, settings: { url: "\${FLAMAPY:-http://flamapy:8000}" } }
  agents-plugin: { enabled: false, settings: { serviceKey: "\${KEY}" }, colour: red }
  bare-plugin:
  odd-plugin: yes
`);
  const { declared, gitHosts, warnings } = loadDeployConfig({ file, env: { KEY: 's3cret' } });
  expect(gitHosts).toEqual({ primary: 'gitlab' });
  expect(declared['analytics-plugin']).toEqual({ enabled: true, settings: { url: 'http://flamapy:8000' } });
  expect(declared['agents-plugin']).toEqual({ enabled: false, settings: { serviceKey: 's3cret' } });
  expect(declared['bare-plugin']).toEqual({ enabled: true, settings: {} });
  expect(declared['odd-plugin']).toBeUndefined();
  expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining('agents-plugin.colour'), expect.stringContaining('odd-plugin')]));
});

test('a file that is not YAML stops the server instead of half-applying', () => {
  expect(() => loadDeployConfig({ file: write('plugins: [unclosed') })).toThrow(/not valid YAML/);
});
