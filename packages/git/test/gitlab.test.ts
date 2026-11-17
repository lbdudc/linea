import { beforeAll, afterEach, afterAll, describe, it, expect } from 'vitest';
import { GitLabProvider } from '../src/index.js';
import { startGitlabDouble } from '../src/testing/index.js';
import { describeGitProviderContract } from '../src/testing/contract.js';

let double: Awaited<ReturnType<typeof startGitlabDouble>>;
beforeAll(async () => { double = await startGitlabDouble(); });
afterEach(() => double.reset());
afterAll(async () => { await double.close(); });

// GitLab, through the in-memory GitLab the other tests use: the contract every provider has to satisfy
describeGitProviderContract({
  name: 'GitLab',
  makeProvider: () => new GitLabProvider({ url: double.url }),
  addMember: async ({ repository, username, accessLevel }) => {
    double.getProject(repository.id).members.push({ id: 1, username, access_level: accessLevel });
  },
  addMilestone: async ({ repository, title }) => {
    double.getProject(repository.id).milestones.push({ id: 1, title, state: 'active', due_date: null });
  },
  signWebhook: ({ body, secret }) => ({ headers: { 'x-gitlab-token': secret }, rawBody: JSON.stringify(body) }),
  pushEvent: ({ repositoryId, branch }) => ({ headers: { 'x-gitlab-event': 'Push Hook' }, body: { object_kind: 'push', ref: `refs/heads/${branch}`, project: { id: repositoryId } } }),
});

describe('GitLabProvider: releases and rollback', () => {
  it('takes back the releases it made, and leaves the tag to the rest of the rollback', async () => {
    const maker = new GitLabProvider({ url: double.url });
    const { repository } = await (async () => {
      const namespace = await maker.createNamespace({ token: 't', name: 'Shop' });
      return { repository: await maker.createRepository({ token: 't', name: 'Shop', namespaceId: namespace.id }) };
    })();
    const git = new GitLabProvider({ url: double.url });
    await git.createTag({ token: 't', id: repository.id, tag: 'v1.0.0', ref: 'main', message: '{}' });
    await git.createRelease({ token: 't', id: repository.id, tag: 'v1.0.0' });
    expect(await maker.getRelease({ token: 't', id: repository.id, tag: 'v1.0.0' })).not.toBeNull();
    await git.rollback();
    expect(await maker.getRelease({ token: 't', id: repository.id, tag: 'v1.0.0' })).toBeNull();
  });
});
