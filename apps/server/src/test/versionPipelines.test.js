import { describe, it, expect } from 'vitest';
import { pipelinesByVersion } from '../model/services/versionPipelines.js';

const at = (s) => `2026-10-14T${s}:00.000Z`;

describe('which pipeline belongs to which version', () => {
  const deployments = [
    { version: '1.0.1', startedAt: at('10:10') },
    { version: '1.0.0', startedAt: at('10:00') },
    { version: '1.0.2', startedAt: at('10:20') },
  ];

  it('gives each version the newest pipeline that began during its generation, before the next one started', () => {
    const pipelines = [
      { id: 1, status: 'success', createdAt: at('10:01') },
      { id: 2, status: 'failed', createdAt: at('10:02') },   // the last one of 1.0.0
      { id: 3, status: 'success', createdAt: at('10:11') },
      { id: 4, status: 'running', createdAt: at('10:21') },
    ];
    const found = pipelinesByVersion({ deployments, pipelines });
    expect(found['1.0.0'].id).toBe(2);
    expect(found['1.0.1'].id).toBe(3);
    expect(found['1.0.2'].id).toBe(4);
  });

  it('leaves out the versions no pipeline started for, and takes a minute of margin for the clocks', () => {
    const found = pipelinesByVersion({
      deployments,
      pipelines: [{ id: 9, status: 'success', createdAt: '2026-10-14T09:59:30.000Z' }],
    });
    expect(found['1.0.0'].id).toBe(9);
    expect(found['1.0.1']).toBeUndefined();
  });

  it('ignores deployments without a start and pipelines without a date', () => {
    const found = pipelinesByVersion({
      deployments: [{ version: '2.0.0' }, { version: '2.0.1', startedAt: at('11:00') }],
      pipelines: [{ id: 1, status: 'success', createdAt: 'nope' }, { id: 2, status: 'success', createdAt: at('11:01') }],
    });
    expect(Object.keys(found)).toEqual(['2.0.1']);
    expect(found['2.0.1'].id).toBe(2);
  });
});
