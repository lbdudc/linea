import { vi, test, expect, describe, beforeEach } from 'vitest';
import { Container } from 'typedi';

const git = {
  createChangeRequest: vi.fn(),
  listChangeRequests: vi.fn(),
  mergeChangeRequest: vi.fn(),
};
vi.mock('../model/git/index.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getGitProvider: () => git,
}));
vi.mock('../model/services/modules/ModularService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, forgetLineProject: vi.fn() };
});

const { default: LineService } = await import('../model/services/LineService.js');
const { forgetLineProject } = await import('../model/services/modules/ModularService.js');
const { default: domainEvents, DOMAIN_EVENTS } = await import('../model/events/domainEvents.js');

const lineService = Container.get(LineService);

beforeEach(() => {
  vi.restoreAllMocks();
  forgetLineProject.mockClear();
  Object.values(git).forEach((fn) => fn.mockReset());
  vi.spyOn(lineService.lineRepository, 'findById').mockResolvedValue({ _id: 'l1', repoId: 77 });
  vi.spyOn(lineService.permissionChecker, 'checkUserExistsAndHasPrivileges').mockResolvedValue({ accessToken: 't' });
  git.createChangeRequest.mockResolvedValue({ number: 5 });
});

describe('LineService.mergePlanBranch', () => {
  test('after a clean merge, what LINEA remembered of the line is dropped and the model change announced', async () => {
    git.mergeChangeRequest.mockResolvedValue(false);
    const changed = vi.fn();
    domainEvents.once(DOMAIN_EVENTS.LINE_MODEL_CHANGED, changed);

    const result = await lineService.mergePlanBranch({ id: 'l1', userId: 'u1', branch: 'plan/x' });

    expect(result).toEqual({ merged: true, conflicts: false, mrIid: 5 });
    expect(forgetLineProject).toHaveBeenCalledWith(77);
    expect(changed).toHaveBeenCalledWith({ lineId: 'l1' });
  });

  test('a merge that conflicts changed nothing on main: nothing is dropped or announced', async () => {
    git.mergeChangeRequest.mockResolvedValue(true);
    const changed = vi.fn();
    domainEvents.once(DOMAIN_EVENTS.LINE_MODEL_CHANGED, changed);

    const result = await lineService.mergePlanBranch({ id: 'l1', userId: 'u1', branch: 'plan/x' });

    expect(result).toMatchObject({ merged: false, conflicts: true });
    expect(forgetLineProject).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    domainEvents.removeAllListeners(DOMAIN_EVENTS.LINE_MODEL_CHANGED);
  });

  test('refuses to merge main into itself', async () => {
    await expect(lineService.mergePlanBranch({ id: 'l1', userId: 'u1', branch: 'main' })).rejects.toThrow(/Refusing/);
    expect(git.createChangeRequest).not.toHaveBeenCalled();
  });
});
