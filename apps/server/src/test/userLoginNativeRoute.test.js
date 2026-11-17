import { vi, test, expect, beforeAll, afterEach, afterAll, describe } from 'vitest';
import express from 'express';
import request from 'supertest';
import { GitLabSession, GitLabAuthError } from 'gitlab-commando';
import User from '../model/entities/user.js';
import { requestAccessTokenMock, getGitLabUserDataMock } from './mocks/index.js';
import { setup, clear, teardown } from './setup.js';
import userRouter from '../rest/routers/userRouter.js';
import { onError } from '../rest/common/onError.js';
import { getGitLabRedirectUri } from '../model/connectors/properties.js';

beforeAll(setup);
afterEach(clear);
afterAll(teardown);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', userRouter);
  app.use(onError);
  return app;
}

describe('POST /api/users/loginFromGitLabNative', () => {
  test('camino feliz: canjea el code contra el redirect_uri de loopback recibido', async () => {
    const username = 'user';
    await new User({ username }).save();

    const mockRequestAccessToken = vi.spyOn(GitLabSession.prototype, 'requestAccessToken');
    mockRequestAccessToken.mockReturnValue(JSON.parse(requestAccessTokenMock));
    vi.spyOn(GitLabSession.prototype, 'getUserData').mockReturnValue(JSON.parse(getGitLabUserDataMock));

    const redirectUri = 'http://127.0.0.1:54231/callback';
    const res = await request(buildApp())
      .post('/api/users/loginFromGitLabNative')
      .send({ code: 'a-code', redirect_uri: redirectUri });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(username);
    expect(mockRequestAccessToken).toHaveBeenCalledWith(
      'a-code',
      expect.anything(),
      expect.anything(),
      redirectUri,
    );
  });

  test.each([
    ['puerto alto', 'http://127.0.0.1:8901/callback'],
    ['puerto distinto', 'http://127.0.0.1:19999/callback'],
    ['IPv6 loopback', 'http://[::1]:5000/callback'],
  ])('acepta cualquier puerto efímero sobre loopback (%s)', async (_label, redirectUri) => {
    const username = 'user2';
    await new User({ username }).save();

    const mockRequestAccessToken = vi.spyOn(GitLabSession.prototype, 'requestAccessToken');
    mockRequestAccessToken.mockReturnValue(JSON.parse(requestAccessTokenMock));
    vi.spyOn(GitLabSession.prototype, 'getUserData').mockReturnValue(JSON.parse(getGitLabUserDataMock));

    const res = await request(buildApp())
      .post('/api/users/loginFromGitLabNative')
      .send({ code: 'a-code', redirect_uri: redirectUri });

    expect(res.status).toBe(200);
    expect(mockRequestAccessToken).toHaveBeenCalledWith(
      'a-code', expect.anything(), expect.anything(), redirectUri,
    );
  });

  test.each([
    ['subdominio que empieza igual que el loopback', 'http://127.0.0.1.attacker.com/callback'],
    ['localhost (resuelve por DNS, no es un literal loopback)', 'http://localhost/callback'],
    ['https en vez de http', 'https://127.0.0.1/callback'],
    ['host remoto directo', 'https://evil.com/callback'],
    ['host remoto con loopback solo en la query', 'http://evil.com/?x=http://127.0.0.1/'],
    ['URI malformada', 'not-a-uri'],
    ['path distinto al fijo del CLI', 'http://127.0.0.1:4000/otra-ruta'],
    ['espacios alrededor', '  http://127.0.0.1:5000/callback  '],
    ['IPv4 decimal', 'http://2130706433/callback'],
    ['IPv4 abreviada', 'http://127.1/callback'],
    ['IPv4 hexadecimal', 'http://0x7f000001/callback'],
    ['IPv4 octal', 'http://0177.0.0.1/callback'],
    ['puntos fullwidth', 'http://127。0。0。1/callback'],
    ['esquema en mayúsculas', 'HTTP://127.0.0.1:5000/callback'],
    ['path traversal literal', 'http://127.0.0.1/../callback'],
    ['path traversal porcentaje-codificado', 'http://127.0.0.1/%2e%2e/callback'],
    ['sin doble barra tras el esquema', 'http:127.0.0.1/callback'],
    ['userinfo hostil (host@host)', 'http://evil.com@127.0.0.1/callback'],
    ['userinfo con credenciales', 'http://user:pass@127.0.0.1/callback'],
    ['query con host hostil', 'http://127.0.0.1/callback?next=http://evil.com'],
    ['fragment con host hostil', 'http://127.0.0.1/callback#@evil.com'],
    ['no es un string (se cuela un array)', ['http://127.0.0.1/callback']],
  ])('rechaza redirect_uri hostil sin canjear nada (%s)', async (_label, redirectUri) => {
    const mockRequestAccessToken = vi.spyOn(GitLabSession.prototype, 'requestAccessToken');
    mockRequestAccessToken.mockReturnValue(JSON.parse(requestAccessTokenMock));

    const res = await request(buildApp())
      .post('/api/users/loginFromGitLabNative')
      .send({ code: 'a-code', redirect_uri: redirectUri });

    expect(res.status).toBe(400);
    expect(mockRequestAccessToken).not.toHaveBeenCalled();
  });

  test('rechaza cuando falta redirect_uri, sin canjear nada', async () => {
    const mockRequestAccessToken = vi.spyOn(GitLabSession.prototype, 'requestAccessToken');
    mockRequestAccessToken.mockReturnValue(JSON.parse(requestAccessTokenMock));

    const res = await request(buildApp())
      .post('/api/users/loginFromGitLabNative')
      .send({ code: 'a-code' });

    expect(res.status).toBe(400);
    expect(mockRequestAccessToken).not.toHaveBeenCalled();
  });

  test('un redirect_uri válido en la query, con el body sin el campo, no cuela (regresión)', async () => {
    const mockRequestAccessToken = vi.spyOn(GitLabSession.prototype, 'requestAccessToken');
    mockRequestAccessToken.mockReturnValue(JSON.parse(requestAccessTokenMock));

    const res = await request(buildApp())
      .post('/api/users/loginFromGitLabNative?redirect_uri=' + encodeURIComponent('http://127.0.0.1:5000/callback'))
      .send({ code: 'a-code' });

    expect(res.status).toBe(400);
    expect(mockRequestAccessToken).not.toHaveBeenCalled();
  });

  test('propaga el error de GitLab si el code es inválido', async () => {
    vi.spyOn(GitLabSession.prototype, 'requestAccessToken').mockImplementation(() => {
      throw new GitLabAuthError();
    });

    const res = await request(buildApp())
      .post('/api/users/loginFromGitLabNative')
      .send({ code: 'bad-code', redirect_uri: 'http://127.0.0.1:4000/callback' });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/users/login/gitlab (regresión: la web no cambia)', () => {
  test('sigue canjeando contra getGitLabRedirectUri(), sin redirect_uri en el body', async () => {
    const username = 'user';
    await new User({ username }).save();

    const mockRequestAccessToken = vi.spyOn(GitLabSession.prototype, 'requestAccessToken');
    mockRequestAccessToken.mockReturnValue(JSON.parse(requestAccessTokenMock));
    vi.spyOn(GitLabSession.prototype, 'getUserData').mockReturnValue(JSON.parse(getGitLabUserDataMock));

    const res = await request(buildApp())
      .post('/api/users/login/gitlab')
      .send({ code: 'a-code' });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(username);
    expect(mockRequestAccessToken).toHaveBeenCalledWith(
      'a-code', expect.anything(), expect.anything(), getGitLabRedirectUri().replace(/\s/g, ''),
    );
  });

  test('un redirect_uri hostil en el body de /login/gitlab se ignora (no hay whitelist nativa aquí, pero tampoco se usa)', async () => {
    const username = 'user';
    await new User({ username }).save();

    const mockRequestAccessToken = vi.spyOn(GitLabSession.prototype, 'requestAccessToken');
    mockRequestAccessToken.mockReturnValue(JSON.parse(requestAccessTokenMock));
    vi.spyOn(GitLabSession.prototype, 'getUserData').mockReturnValue(JSON.parse(getGitLabUserDataMock));

    const res = await request(buildApp())
      .post('/api/users/login/gitlab')
      .send({ code: 'a-code', redirect_uri: 'https://evil.com/callback' });

    expect(res.status).toBe(200);
    expect(mockRequestAccessToken).toHaveBeenCalledWith(
      'a-code', expect.anything(), expect.anything(), getGitLabRedirectUri().replace(/\s/g, ''),
    );
  });

  test('sigue rechazando un body sin code (validator sin cambios)', async () => {
    const res = await request(buildApp())
      .post('/api/users/login/gitlab')
      .send({});

    expect(res.status).toBe(400);
  });
});
