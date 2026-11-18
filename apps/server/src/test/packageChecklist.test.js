import { describe, test, expect } from 'vitest';
import { buildChecklist } from '../model/services/modules/packageChecklist.js';

const ok = { ok: true, diagnostics: [], resolved: [{}, {}] };
const preview = { version: '0.2.0', latest: '0.1.0', versionError: null, suggestedBump: 'minor', commitsSince: 3, warnings: [] };
const status = (list, id) => list.find((entry) => entry.id === id)?.status;

describe('the checklist of a package', () => {
  test('passes everything for a package that can be published', () => {
    const list = buildChecklist({ manifest: { version: '0.2.0' }, report: ok, preview, canPublish: true, publishRule: 'everyone' });
    expect(list.map((entry) => entry.status)).not.toContain('fail');
    expect(list.find((entry) => entry.id === 'changes')).toMatchObject({ status: 'pass', count: 3 });
    expect(list.find((entry) => entry.id === 'resolves')).toMatchObject({ status: 'pass', count: 2 });
  });

  test('fails on a manifest that does not read, and says no more than it knows', () => {
    const list = buildChecklist({ manifestError: 'bad json', canPublish: true, publishRule: 'everyone' });
    expect(list.map((entry) => entry.id)).toEqual(['manifest', 'permission']);
    expect(status(list, 'manifest')).toBe('fail');
  });

  test('fails on a version that is already published and on errors the check found', () => {
    const list = buildChecklist({
      manifest: { version: '0.1.0' },
      report: { ok: false, diagnostics: [{ severity: 'error', message: 'cannot resolve x' }, { severity: 'warning', message: 'w' }], resolved: [] },
      preview: { ...preview, version: '0.1.0', versionError: 'v0.1.0 is already published', commitsSince: 0 },
      canPublish: true, publishRule: 'everyone',
    });
    expect(status(list, 'version')).toBe('fail');
    expect(list.find((entry) => entry.id === 'resolves')).toMatchObject({ status: 'fail', count: 1, detail: 'cannot resolve x' });
    expect(status(list, 'warnings')).toBe('warn');
    expect(status(list, 'changes')).toBe('warn');
  });

  test('warns when the version does not match the commits, and fails for a person who may not publish', () => {
    const list = buildChecklist({ manifest: { version: '0.1.1' }, report: ok, preview: { ...preview, warnings: ['imply a minor one'] }, canPublish: false, publishRule: 'admins' });
    expect(list.find((entry) => entry.id === 'bump')).toMatchObject({ status: 'warn', suggested: 'minor' });
    expect(list.find((entry) => entry.id === 'permission')).toMatchObject({ status: 'fail', rule: 'admins' });
  });
});
