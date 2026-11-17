import { describe, it, expect, vi } from 'vitest';
import { ACCESS } from '@lbdudc/linea-git';
import { PermissionError } from '../model/errors/errors.js';

const git = {
  kind: 'gitlab',
  getFileRevision: vi.fn().mockRejectedValue(Object.assign(new Error('not found'), { status: 404 })),
  getCiRunners: vi.fn().mockResolvedValue({ supported: true, instanceRunners: true, runners: [] }),
  getAccessLevel: vi.fn(),
  isAuthError: (error) => error?.auth === true,
};
vi.mock('../model/git/index.js', async (importOriginal) => ({ ...(await importOriginal()), getGitProvider: () => git }));

const { default: PermissionChecker } = await import('../model/services/PermissionChecker.js');
const { default: ProductCiService } = await import('../model/services/ProductCiService.js');
const { default: LineCiService } = await import('../model/services/LineCiService.js');

const user = (extra = {}) => ({ username: 'ana', gitTokens: { gitlab: { accessToken: 't' } }, ...extra });
const checker = (found = user()) => {
  const permissions = new PermissionChecker();
  permissions.userRepository = { findById: vi.fn().mockResolvedValue(found) };
  return permissions;
};
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const productService = (permissionChecker) => {
  const service = new ProductCiService();
  service.productRepository = { findById: vi.fn().mockResolvedValue({ repo: { id: 1 } }) };
  service.permissionChecker = permissionChecker;
  return service;
};
const lineService = (permissionChecker) => {
  const service = new LineCiService();
  service.lineRepository = { findById: vi.fn().mockResolvedValue({ repoId: 1 }) };
  service.permissionChecker = permissionChecker;
  return service;
};

describe('what a person may change', () => {
  it('follows the level on the repository', async () => {
    const args = { userId: 'u', repoId: 1, accessLevel: ACCESS.MAINTAINER };
    git.getAccessLevel.mockResolvedValue(ACCESS.MAINTAINER);
    expect(await checker().hasPrivileges(args, git)).toBe(true);
    const silenced = quiet();
    git.getAccessLevel.mockResolvedValue(ACCESS.DEVELOPER);
    expect(await checker().hasPrivileges(args, git)).toBe(false);
    silenced.mockRestore();
  });

  it('is everything for an administrator of LINEA', async () => {
    git.getAccessLevel.mockResolvedValue(0);
    expect(await checker(user({ admin: true })).hasPrivileges({ userId: 'u', repoId: 1, accessLevel: ACCESS.MAINTAINER }, git)).toBe(true);
  });

  it('does not take an expired token for a lack of permissions', async () => {
    git.getAccessLevel.mockRejectedValue(Object.assign(new Error('expired'), { auth: true }));
    await expect(checker().hasPrivileges({ userId: 'u', repoId: 1, accessLevel: ACCESS.MAINTAINER }, git)).rejects.toThrow('expired');
  });
});

describe('the CI configuration', () => {
  for (const [name, service] of [['of a product', productService], ['of an SPL', lineService]]) {
    it(`${name} says a reporter can read it but not change it`, async () => {
      git.getAccessLevel.mockResolvedValue(ACCESS.REPORTER);
      const silenced = quiet();
      const answer = await service(checker()).getCi({ id: 'x', userId: 'u' });
      silenced.mockRestore();
      expect(answer.canEdit).toBe(false);
      expect(answer.config).toBeTruthy();
    });

    it(`${name} says a maintainer can change it`, async () => {
      git.getAccessLevel.mockResolvedValue(ACCESS.MAINTAINER);
      expect((await service(checker()).getCi({ id: 'x', userId: 'u' })).canEdit).toBe(true);
    });

    it(`${name} refuses a change from a reporter, whatever the page offers`, async () => {
      git.getAccessLevel.mockResolvedValue(ACCESS.REPORTER);
      const silenced = quiet();
      await expect(service(checker()).saveCi({ id: 'x', userId: 'u', config: {} })).rejects.toBeInstanceOf(PermissionError);
      silenced.mockRestore();
    });
  }
});
