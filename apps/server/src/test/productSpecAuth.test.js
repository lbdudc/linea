import { describe, it, expect, vi } from 'vitest';

const { provider } = vi.hoisted(() => ({
  provider: { getFileRevision: vi.fn(), isAuthError: (error) => error?.name === 'GitAuthError' },
}));
vi.mock('../model/git/index.js', async (importOriginal) => ({ ...(await importOriginal()), getGitProvider: () => provider }));

const { default: ProductSpecService } = await import('../model/services/ProductSpecService.js');

const args = { token: 't', productProjectId: 1, host: 'gitlab', context: 'test', fallbackSpec: { basicData: { name: 'cached' } } };

describe('reading the spec of a product with a token the host does not accept', () => {
  it('answers with the authentication error at once: no retries, and no old copy served as if the host were down', async () => {
    provider.getFileRevision.mockReset().mockRejectedValue(Object.assign(new Error('invalid_token'), { name: 'GitAuthError', status: 401 }));
    await expect(new ProductSpecService().getSpecFromHostOrCache(args)).rejects.toMatchObject({ name: 'GitAuthError' });
    expect(provider.getFileRevision).toHaveBeenCalledTimes(1);
  });

  it('still serves the saved copy when the host is down for any other reason', async () => {
    provider.getFileRevision.mockReset().mockRejectedValue(Object.assign(new Error('bad gateway'), { status: 502 }));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const answer = await new ProductSpecService().getSpecFromHostOrCache(args);
    expect(answer).toMatchObject({ source: 'mongo', reason: 'infra' });
    quiet.mockRestore();
  }, 30000);
});
