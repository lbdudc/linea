import { describe, expect, it } from 'vitest';
import { gitUsernameOn } from '../model/services/ConflictService.js';

describe('gitUsernameOn: the name git is given with the token of each host', () => {
  it('uses the oauth2 convention on GitLab', () => {
    expect(gitUsernameOn({ username: 'ana' }, 'gitlab')).toBe('oauth2');
  });

  it('uses x-access-token on GitHub', () => {
    expect(gitUsernameOn({ username: 'ana' }, 'github')).toBe('x-access-token');
  });

  it('uses the account name on the local host, which only opens a repository to the account its token is of', () => {
    expect(gitUsernameOn({ username: 'dev', gitHost: 'local' }, 'local')).toBe('dev');
  });
});

describe('a repository git cannot open is not an internal error', () => {
  it('answers 502 with what git said, so the person is told why', async () => {
    const { onError } = await import('../rest/common/onError.js');
    const { RepositoryAccessError } = await import('../model/errors/errors.js');
    const res = { status: (code) => { res.code = code; return res; }, json: (body) => { res.body = body; return res; } };

    onError(new RepositoryAccessError('Authentication failed'), {}, res, () => {});

    expect(res.code).toBe(502);
    expect(res.body).toEqual({ error: 'error_messages.repository_access_failed', detail: 'Authentication failed' });
  });
});
