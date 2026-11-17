import { beforeAll, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import { GitLabAuthError } from 'gitlab-commando';
import { GitLabProvider } from '../src/index.js';
import { startGitlabDouble } from '../src/testing/index.js';

let double: any;
beforeAll(async () => { double = await startGitlabDouble(); });
afterEach(() => { vi.restoreAllMocks(); double.reset(); });
afterAll(async () => { await double.close(); });

const token = 'token';
const invalid = () => Object.assign(new GitLabAuthError('invalid_token'), { status: 401 });
const refused = (status: number) => Object.assign(new Error('refused'), { status });

const requestIn = async (git: GitLabProvider, name: string) => {
  const repository = await git.createRepository({ token, name, initializeWithReadme: true } as any);
  await git.createBranch({ token, id: repository.id, branch: 'change', ref: 'main' });
  await git.commit({ token, id: repository.id, branch: 'change', message: 'Change', actions: [{ action: 'create', path: 'b.txt', content: 'b' }] } as any);
  const request = await git.createChangeRequest({ token, id: repository.id, title: 'Change', sourceBranch: 'change', targetBranch: 'main' });
  return { args: { token, id: repository.id, number: request.number }, id: repository.id };
};

describe('merging a change request', () => {
  it('merges and takes the source branch away', async () => {
    const git = new GitLabProvider({ url: double.url });
    const { args, id } = await requestIn(git, 'merge-ok');
    expect(await git.mergeChangeRequest(args)).toBe(false);
    expect((await git.listChangeRequests({ token, id, state: 'all' }))[0]).toMatchObject({ state: 'merged' });
    await expect(git.getBranch({ token, id, branch: 'change' })).rejects.toThrow();
  });

  it('keeps the source branch when asked to', async () => {
    const git = new GitLabProvider({ url: double.url });
    const { args, id } = await requestIn(git, 'merge-keep');
    expect(await git.mergeChangeRequest({ ...args, deleteSourceBranch: false })).toBe(false);
    expect(await git.getBranch({ token, id, branch: 'change' })).toBeTruthy();
  });

  it('has nothing to do on one that is already merged, as when it is asked again', async () => {
    const git = new GitLabProvider({ url: double.url });
    const { args } = await requestIn(git, 'merge-twice');
    await git.mergeChangeRequest(args);
    expect(await git.mergeChangeRequest(args)).toBe(false);
  });

  it('says that one that is closed did not merge', async () => {
    const git = new GitLabProvider({ url: double.url });
    const { args } = await requestIn(git, 'merge-closed');
    await git.updateMergeRequest({ ...args, changes: { state: 'closed' } } as any);
    expect(await git.mergeChangeRequest(args)).toBe(true);
  });

  it('says that one with conflicts did not merge', async () => {
    const git = new GitLabProvider({ url: double.url });
    const { args } = await requestIn(git, 'merge-conflict');
    vi.spyOn((git as any).client, 'send').mockRejectedValue(refused(405));
    vi.spyOn((git as any).client, 'getMergeRequest').mockResolvedValue({ state: 'opened', detailed_merge_status: 'conflict' });
    expect(await git.mergeChangeRequest(args)).toBe(true);
  });

  it('asks again while GitLab cannot do it yet', async () => {
    const git = new GitLabProvider({ url: double.url });
    const { args } = await requestIn(git, 'merge-later');
    const send = vi.spyOn((git as any).client, 'send');
    send.mockRejectedValueOnce(refused(422)).mockRejectedValueOnce(new Error('network'));
    expect(await git.mergeChangeRequest(args)).toBe(false);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('gives up with an error when GitLab never takes it, instead of waiting for ever', async () => {
    const git = new GitLabProvider({ url: double.url, mergeWaitMs: 50 });
    const { args } = await requestIn(git, 'merge-never');
    vi.spyOn((git as any).client, 'send').mockRejectedValue(refused(422));
    await expect(git.mergeChangeRequest(args)).rejects.toThrow('in time');
  });

  it('tells at once that the token is no good when asking for the merge, instead of waiting for ever', async () => {
    const git = new GitLabProvider({ url: double.url });
    const { args } = await requestIn(git, 'merge-token');
    const send = vi.spyOn((git as any).client, 'send').mockRejectedValue(invalid());
    const error = await git.mergeChangeRequest(args).catch((failure) => failure);
    expect(git.isAuthError(error)).toBe(true);
    expect(send).toHaveBeenCalledOnce();
  });

  it('tells it too when the token stops being good while looking at how it went', async () => {
    const git = new GitLabProvider({ url: double.url });
    const { args } = await requestIn(git, 'merge-token-after');
    vi.spyOn((git as any).client, 'getMergeRequest').mockRejectedValue(invalid());
    const error = await git.mergeChangeRequest(args).catch((failure) => failure);
    expect(git.isAuthError(error)).toBe(true);
  });
});
