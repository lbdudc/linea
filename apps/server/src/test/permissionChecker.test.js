import User from '../model/entities/user.js';
import { PermissionError } from '../model/errors/errors.js';
import { setup, clear, teardown } from './setup.js';
import { vi, test, expect, afterEach, beforeAll, afterAll } from "vitest";
import { GitLabSession, GitLabAuthError } from "gitlab-commando";
import { Container } from 'typedi';
import PermissionChecker from '../model/services/PermissionChecker.js';

const permissionChecker = Container.get(PermissionChecker);

test('propagates GitLabAuthError instead of masking it as PermissionError (project scope)', async () => {
    const user = await new User({ username: 'user', accessToken: 'expired-token' }).save();

    vi.spyOn(GitLabSession.prototype, 'getProjectMembers').mockImplementation(() => {
      throw new GitLabAuthError();
    });

    await expect(() =>
      permissionChecker.checkUserExistsAndHasPrivileges({
        userId: user._id,
        repoId: 1,
        accessLevel: 30,
      })
    ).rejects.toThrow(GitLabAuthError);
});

test('still maps unrelated errors to PermissionError', async () => {
    const user = await new User({ username: 'user', accessToken: 'token' }).save();

    vi.spyOn(GitLabSession.prototype, 'getProjectMembers').mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(() =>
      permissionChecker.checkUserExistsAndHasPrivileges({
        userId: user._id,
        repoId: 1,
        accessLevel: 30,
      })
    ).rejects.toThrow(PermissionError);
});

beforeAll(setup);
afterEach(clear);
afterAll(teardown);
