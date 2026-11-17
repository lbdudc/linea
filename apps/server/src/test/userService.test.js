import User from '../model/entities/user.js';
import { UserNotFoundError } from '../model/errors/errors.js';
import { requestAccessTokenMock, getGitLabUserDataMock } from './mocks/index.js';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { setup, clear, teardown } from './setup.js';
import { vi, test, expect, afterEach, beforeAll, afterAll } from "vitest";
import { GitLabSession, GitLabAuthError } from "gitlab-commando";
import { Container } from 'typedi';
import UserService from '../model/services/UserService.js';

const userService = Container.get(UserService);

test('Login existent user from id sucessfully', async () => {
    const username = 'user';

    const createdUser = await new User({ username }).save();

    const mockRequestAccessToken = vi.spyOn(GitLabSession.prototype, 'refreshAccessToken');
    mockRequestAccessToken.mockReturnValue(JSON.parse(requestAccessTokenMock));

    const mockGetGitLabUserData = vi.spyOn(GitLabSession.prototype, 'getUserData');
    mockGetGitLabUserData.mockReturnValue(JSON.parse(getGitLabUserDataMock));

    const loggedUser = await userService.loginUserFromId({userId: createdUser._id});

    expect(loggedUser.username).toBe(username);
});

test('Logins of the same user at once share one refresh of the git token (it rotates, a second one would fail)', async () => {
    await new User({ username: 'user', accessToken: 'old-token' }).save();
    const stored = await User.findOne({ username: 'user' });

    const refresh = vi.spyOn(GitLabSession.prototype, 'refreshAccessToken').mockReturnValue(JSON.parse(requestAccessTokenMock));
    vi.spyOn(GitLabSession.prototype, 'getUserData').mockReturnValue(JSON.parse(getGitLabUserDataMock));

    const users = await Promise.all([1, 2, 3].map(() => userService.loginUserFromId({ userId: stored._id })));
    await userService.loginUserFromId({ userId: stored._id });

    expect(users.every((user) => user.username === 'user')).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
});

test('The git credentials of a user: the host and their own, renewed, token', async () => {
    await new User({ username: 'user', accessToken: 'old-token' }).save();
    const stored = await User.findOne({ username: 'user' });

    vi.spyOn(GitLabSession.prototype, 'refreshAccessToken').mockReturnValue(JSON.parse(requestAccessTokenMock));
    vi.spyOn(GitLabSession.prototype, 'getUserData').mockReturnValue(JSON.parse(getGitLabUserDataMock));

    const credentials = await userService.getGitCredentials({ userId: stored._id });

    expect(credentials.provider).toBe('gitlab');
    expect(credentials.username).toBe('user');
    expect(credentials.token).toBe(JSON.parse(requestAccessTokenMock).access_token);
    expect(credentials.token).not.toBe('old-token');
    expect(credentials.host).toHaveProperty('url');
    expect(Object.keys(credentials).sort()).toEqual(['host', 'provider', 'token', 'username']);
});

test('The git credentials of a user that does not exist', async () => {
    await expect(() => userService.getGitCredentials({ userId: new mongoose.Types.ObjectId() })).rejects.toThrow(UserNotFoundError);
});

test('Login non-existent user from id', async () => {
    const userId = new mongoose.Types.ObjectId();

    await expect(() => userService.loginUserFromId({ userId })).rejects.toThrow(UserNotFoundError);
});

test('Login from GitLab sucessfully', async () => {
    const username = 'user';
    const password = 'password';
    const hashedPassword = await bcrypt.hash(password, 10);

    await new User({ username, password: hashedPassword }).save();

    const mockRequestAccessToken = vi.spyOn(GitLabSession.prototype, 'requestAccessToken');
    mockRequestAccessToken.mockReturnValue(JSON.parse(requestAccessTokenMock));

    const mockGetGitLabUserData = vi.spyOn(GitLabSession.prototype, 'getUserData');
    mockGetGitLabUserData.mockReturnValue(JSON.parse(getGitLabUserDataMock));

    const user = await userService.loginUserFromGitLab({username, password});

    expect(user.username).toBe(username);
});

test('Login from GitLab incorrectly', async () => {
    const username = 'user';
    const password = 'incorrectPassword';
    const hashedPassword = await bcrypt.hash('password', 10);

    await new User({ username, password: hashedPassword }).save();

    const mockRequestAccessToken = vi.spyOn(GitLabSession.prototype, 'requestAccessToken');
    mockRequestAccessToken.mockImplementation(() => {
      throw new GitLabAuthError();
    });

    await expect(() => userService.loginUserFromGitLab({ username, password })).rejects.toThrow(GitLabAuthError);
});

test('Login from GitLab (native) exchanges the code against the given redirect_uri', async () => {
    const username = 'user';
    await new User({ username }).save();

    const mockRequestAccessToken = vi.spyOn(GitLabSession.prototype, 'requestAccessToken');
    mockRequestAccessToken.mockReturnValue(JSON.parse(requestAccessTokenMock));

    const mockGetGitLabUserData = vi.spyOn(GitLabSession.prototype, 'getUserData');
    mockGetGitLabUserData.mockReturnValue(JSON.parse(getGitLabUserDataMock));

    const redirectUri = 'http://127.0.0.1:54231/callback';
    const user = await userService.loginUserFromGitLabNative({ code: 'a-code', redirect_uri: redirectUri });

    expect(user.username).toBe(username);
    expect(mockRequestAccessToken).toHaveBeenCalledWith(
      'a-code',
      expect.anything(),
      expect.anything(),
      redirectUri,
    );
});

test('Login from GitLab (native) incorrectly', async () => {
    const mockRequestAccessToken = vi.spyOn(GitLabSession.prototype, 'requestAccessToken');
    mockRequestAccessToken.mockImplementation(() => {
      throw new GitLabAuthError();
    });

    await expect(() => userService.loginUserFromGitLabNative({
      code: 'a-code',
      redirect_uri: 'http://127.0.0.1:54231/callback',
    })).rejects.toThrow(GitLabAuthError);
});

beforeAll(setup);
afterEach(clear);
afterAll(teardown);