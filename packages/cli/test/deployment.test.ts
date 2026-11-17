import { describe, expect, test } from 'bun:test';
import { describeChanges, describePipeline } from '../src/commands/product.js';

describe('the deployment of a version, in words', () => {
  test('a pipeline with a failed job says which one and what it printed', () => {
    const text = describePipeline({
      pipeline: { id: 7, status: 'failed', webUrl: 'http://git/-/pipelines/7', createdAt: '2026-10-14T10:00:00Z', ref: 'main' },
      jobs: [
        { id: 1, name: 'build', stage: 'build', status: 'success', duration: 6 },
        { id: 2, name: 'test', stage: 'test', status: 'failed', duration: 6 },
        { id: 3, name: 'deploy', stage: 'deploy', status: 'skipped', duration: null },
      ],
      failed: { id: 2, name: 'test', trace: 'expected 3 features, received 2\nERROR: Job failed' },
    });
    expect(text).toContain('Pipeline ✗ failed');
    expect(text).toContain('✓ build');
    expect(text).toContain('✗ test');
    expect(text).toContain('– deploy');
    expect(text).toContain('expected 3 features, received 2');
  });

  test('no pipeline says so instead of printing an empty one', () => {
    expect(describePipeline({ pipeline: null, jobs: [], failed: null })).toContain('No pipeline');
  });

  test('the changes of a version are the features and the models that moved', () => {
    const text = describeChanges({
      version: '1.1.0',
      spec: { features: ['Core', 'Maps'] },
      models: { basic: 'a\nb\nc' },
      previous: { version: '1.0.0', spec: { features: ['Core', 'Auth'] }, models: { basic: 'a\nb' } },
    });
    expect(text).toContain('v1.1.0  ←  v1.0.0');
    expect(text).toContain('+ Maps');
    expect(text).toContain('- Auth');
    expect(text).toContain('~ basic  (+1 −0 lines)');
  });

  test('a first generation has nothing to compare with', () => {
    const text = describeChanges({ version: '0.0.1', spec: { features: ['Core'] }, previous: null });
    expect(text).toContain('First generation');
  });
});
