// @ts-nocheck: written as plain JavaScript (it is the suite the server tests used); only its shape matters to a caller
import { describe, it, expect } from 'vitest';
import { GIT_PROVIDER_METHODS, type GitProvider } from '../provider.js';
import { deleteEmptyLineNamespace, deleteLineOnHost, deleteProductOnHost } from '../deletion.js';

type Id = string | number;

export interface GitProviderContractOptions {
  name: string;
  makeProvider: () => GitProvider;
  addMember: (args: { repository: { id: Id }, username: string, accessLevel: number }) => void | Promise<void>;
  signWebhook: (args: { body: unknown, secret: string }) => { headers: Record<string, string>, rawBody: string };
  pushEvent: (args: { repositoryId: Id, branch: string }) => { headers: Record<string, string>, body: unknown };
  /** Makes a milestone the host knows (a host where they are free text needs none). */
  addMilestone?: (args: { repository: { id: Id }, title: string }) => void | Promise<void>;
}

/**
 * What every `GitProvider` has to do, whatever host is behind it. A host passes `makeProvider` (a new provider on a clean host each call)
 * and the contract runs against it: if a new provider (GitHub...) passes this, the services work on it, because the services only use
 * what is checked here.
 *
 * `status` of an error is what the services look at (404: not there, 400/409: a change made from a stale revision).
 */
export const describeGitProviderContract = ({ name, makeProvider, addMember, signWebhook, pushEvent, addMilestone }: GitProviderContractOptions) => {
  const token = 'fake-token';

  // in LINEA a namespace and the repository in it have the same name
  const repoIn = async (git, { topics = ['product'], repoName = 'Shop', namespaceName = repoName } = {}) => {
    const namespace = await git.createNamespace({ token, name: namespaceName });
    const repository = await git.createRepository({ token, name: repoName, namespaceId: namespace.id, topics });
    return { namespace, repository };
  };

  describe(`GitProvider contract: ${name}`, () => {
    it('has every method of the contract', () => {
      const git = makeProvider();
      for (const method of GIT_PROVIDER_METHODS) expect(typeof git[method], method).toBe('function');
      expect(['local', 'gitlab', 'github']).toContain(git.kind);
    });

    it('creates a namespace and a repository in it, and describes them in the neutral shapes', async () => {
      const git = makeProvider();
      const { namespace, repository } = await repoIn(git);
      expect(namespace).toMatchObject({ name: 'Shop' });
      expect(namespace.id).toBeDefined();
      expect(repository).toMatchObject({ name: 'Shop', topics: ['product'] });
      expect(repository.namespaceId).toBeDefined();
      expect(repository.id).toBeDefined();
      expect(repository.path).toMatch(/Acme.*Shop|Shop/);
      expect(repository.webUrl).toMatch(/^https?:\/\//);
      expect(typeof repository.webIdeUrl).toBe('string');
      expect((await git.getRepository({ token, id: repository.id })).path).toBe(repository.path);
    });

    it('finds a repository and a namespace by their path, and says there is none when there is none', async () => {
      const git = makeProvider();
      const { namespace, repository } = await repoIn(git, { repoName: 'Findable' });
      expect((await git.findRepository({ token, path: repository.path }))?.id).toBe(repository.id);
      expect(await git.findRepository({ token, path: 'nobody/nothing' })).toBeNull();
      const [place] = await git.listNamespaces({ token });
      expect((await git.findNamespace({ token, fullPath: place.fullPath }))?.fullPath).toBe(place.fullPath);
      expect(await git.findNamespace({ token, fullPath: 'no-such-namespace' })).toBeNull();
      expect(namespace.name).toBe('Findable');
    });

    it('adds a topic once', async () => {
      const git = makeProvider();
      const { repository } = await repoIn(git, { topics: ['product'] });
      await git.addTopic({ token, id: repository.id, topic: 'extra' });
      await git.addTopic({ token, id: repository.id, topic: 'extra' });
      expect((await git.getRepository({ token, id: repository.id })).topics.sort()).toEqual(['extra', 'product']);
    });

    it('lists the repositories that have a topic, and only those', async () => {
      const git = makeProvider();
      await repoIn(git, { topics: ['product'], repoName: 'A' });
      await repoIn(git, { topics: ['spl'], repoName: 'B' });
      expect((await git.listRepositories({ token, topic: 'product' })).map((r) => r.name)).toEqual(['A']);
      expect((await git.listRepositories({ token, topic: 'spl' })).map((r) => r.name)).toEqual(['B']);
    });

    it('lists the namespaces the user can create things in, and a listed one can be the parent of a new one', async () => {
      const git = makeProvider();
      await git.createNamespace({ token, name: 'Visible' });
      const namespaces = await git.listNamespaces({ token });
      expect(namespaces.length).toBeGreaterThan(0);
      for (const namespace of namespaces) {
        expect(namespace.id).toBeDefined();
        expect(typeof namespace.fullPath).toBe('string');
      }
      const child = await git.createNamespace({ token, name: 'Child', parentId: namespaces[0].id });
      const repository = await git.createRepository({ token, name: 'Child', namespaceId: child.id, topics: ['product'] });
      expect(repository.name).toBe('Child');
    });

    it('keeps a line and its products together: a product knows its line, renames with it, and goes when the line goes', async () => {
      const git = makeProvider();
      const lineNs = await git.createNamespace({ token, name: 'Line1' });
      const line = await git.createRepository({ token, name: 'Line1', namespaceId: lineNs.id, topics: ['spl'] });
      const productNs = await git.createNamespace({ token, name: 'Prod1', parentId: line.namespaceId });
      const product = await git.createRepository({ token, name: 'Prod1', namespaceId: productNs.id, topics: ['product'] });

      expect(product.name).toBe('Prod1');
      expect(product.parentNamespaceId).toBe(line.namespaceId);
      const listed = await git.listRepositories({ token, topic: 'product' });
      expect(listed.map((r) => [r.name, r.parentNamespaceId])).toEqual([['Prod1', line.namespaceId]]);
      expect(listed[0].topics).toEqual(['product']);

      await git.renameNamespace({ token, id: product.namespaceId, name: 'Prod2' });
      const renamed = await git.renameRepository({ token, id: product.id, name: 'Prod2' });
      expect(renamed.name).toBe('Prod2');
      expect(renamed.parentNamespaceId).toBe(line.namespaceId);
      expect((await git.getRepository({ token, id: product.id })).name).toBe('Prod2');

      await git.deleteNamespace({ token, id: line.namespaceId });
      expect(await git.listRepositories({ token, topic: 'product' })).toEqual([]);
      expect(await git.listRepositories({ token, topic: 'spl' })).toEqual([]);
    });

    it('deletes a line with the products chosen, and what is kept stays until it goes too', async () => {
      const git = makeProvider();
      const lineSpace = await git.createNamespace({ token, name: 'Del' });
      const line = await git.createRepository({ token, name: 'Del', namespaceId: lineSpace.id, topics: ['spl'] });
      const makeProduct = async (name) => {
        const space = await git.createNamespace({ token, name, parentId: line.namespaceId });
        const repository = await git.createRepository({ token, name, namespaceId: space.id, topics: ['product'] });
        return { id: name, repositoryId: repository.id, namespaceId: repository.namespaceId };
      };
      const gone = await makeProduct('DelGone');
      const kept = await makeProduct('DelKept');

      const plan = await deleteLineOnHost({
        provider: git, token, line: { repositoryId: line.id, namespaceId: line.namespaceId }, products: [gone, kept], keepProductIds: ['DelKept'],
      });

      expect(plan.lineSurvives).toBe(true);
      expect((await git.listRepositories({ token, topic: 'spl' })).map((r) => r.name)).not.toContain('Del');
      expect((await git.listRepositories({ token, topic: 'product' })).map((r) => r.id)).toEqual([kept.repositoryId]);

      await deleteProductOnHost({ provider: git, token, product: kept });
      await deleteEmptyLineNamespace({ provider: git, token, namespaceId: line.namespaceId });
      expect(await git.listRepositories({ token, topic: 'product' })).toEqual([]);
    });

    it('deletes a line and every product of it at once', async () => {
      const git = makeProvider();
      const lineSpace = await git.createNamespace({ token, name: 'DelAll' });
      const line = await git.createRepository({ token, name: 'DelAll', namespaceId: lineSpace.id, topics: ['spl'] });
      const space = await git.createNamespace({ token, name: 'DelAllProduct', parentId: line.namespaceId });
      const repository = await git.createRepository({ token, name: 'DelAllProduct', namespaceId: space.id, topics: ['product'] });

      await deleteLineOnHost({
        provider: git, token, line: { repositoryId: line.id, namespaceId: line.namespaceId },
        products: [{ id: 'p', repositoryId: repository.id, namespaceId: repository.namespaceId }],
      });

      expect(await git.listRepositories({ token, topic: 'spl' })).toEqual([]);
      expect(await git.listRepositories({ token, topic: 'product' })).toEqual([]);
    });

    it('a host that deletes at once has nothing to restore, and says so', async () => {
      const git = makeProvider();
      if (git.capabilities().deletion.delayed) return;
      await expect(git.restoreRepository({ token, id: 1 })).rejects.toMatchObject({ status: 400 });
      await expect(git.restoreNamespace({ token, id: 1 })).rejects.toMatchObject({ status: 400 });
    });

    it('says how the host deletes', () => {
      const { deletion } = makeProvider().capabilities();
      expect(typeof deletion.namespaceIsRepository).toBe('boolean');
      expect(typeof deletion.delayed).toBe('boolean');
    });

    it('makes the base branch the first one of a product, and then lets another be the default', async () => {
      const git = makeProvider();
      const namespace = await git.createNamespace({ token, name: 'Gen' });
      const repository = await git.createRepository({ token, name: 'Gen', namespaceId: namespace.id, topics: ['product'], defaultBranch: 'bigbang' });
      expect(repository.defaultBranch).toBe('bigbang');
      await git.createBranch({ token, id: repository.id, branch: 'main', ref: 'bigbang' });
      await git.setDefaultBranch({ token, id: repository.id, branch: 'main' });
      expect((await git.getRepository({ token, id: repository.id })).defaultBranch).toBe('main');
      expect((await git.getBranch({ token, id: repository.id, branch: 'bigbang' })).name).toBe('bigbang');
    });

    it('reads and writes files: base64 content that round-trips UTF-8, and a revision to quote later', async () => {
      const git = makeProvider();
      const { repository } = await repoIn(git);
      const text = 'features\n\tConfiguración\n';
      await git.createFile({ token, id: repository.id, path: 'src/model.uvl', branch: 'main', content: text });
      const file = await git.getFile({ token, id: repository.id, path: 'src/model.uvl', ref: 'main' });
      expect(file.encoding).toBe('base64');
      expect(Buffer.from(file.content, 'base64').toString('utf8')).toBe(text);
      expect(file.revision).toBeTruthy();
      expect(file.path).toBe('src/model.uvl');

      await git.saveFile({ token, id: repository.id, path: 'src/model.uvl', branch: 'main', content: 'features\n\tOther\n' });
      const raw = await git.readFile({ token, id: repository.id, path: 'src/model.uvl', ref: 'main' });
      expect(raw.toString('utf8')).toBe('features\n\tOther\n');
      expect(await git.readFile({ token, id: repository.id, path: 'nothing.txt', ref: 'main' })).toBeNull();
      expect(await git.listFiles({ token, id: repository.id, ref: 'main' })).toContain('src/model.uvl');
    });

    it('says a file is not there with status 404', async () => {
      const git = makeProvider();
      const { repository } = await repoIn(git);
      await expect(git.getFileRevision({ token, id: repository.id, path: 'missing.json', ref: 'main' })).rejects.toMatchObject({ status: 404 });
    });

    it('commits several changes at once, and refuses one made from a stale revision', async () => {
      const git = makeProvider();
      const { repository } = await repoIn(git);
      await git.commit({ token, id: repository.id, branch: 'main', message: 'two files', actions: [
        { action: 'create', path: 'a.txt', content: 'a' },
        { action: 'create', path: 'b.txt', content: 'b' },
      ] });
      const files = await git.listFiles({ token, id: repository.id, ref: 'main' });
      expect(files).toEqual(expect.arrayContaining(['a.txt', 'b.txt']));

      const before = await git.getFileRevision({ token, id: repository.id, path: 'a.txt', ref: 'main' });
      await git.commit({ token, id: repository.id, branch: 'main', message: 'update', track: false, actions: [
        { action: 'update', path: 'a.txt', content: 'a2', expectedRevision: before.revision },
      ] });
      const stale = await git.commit({ token, id: repository.id, branch: 'main', message: 'stale', track: false, actions: [
        { action: 'update', path: 'a.txt', content: 'a3', expectedRevision: before.revision },
      ] }).catch((error) => error);
      expect([400, 409]).toContain(stale?.status);

      await git.commit({ token, id: repository.id, branch: 'main', message: 'delete', actions: [{ action: 'delete', path: 'b.txt' }] });
      expect(await git.listFiles({ token, id: repository.id, ref: 'main' })).not.toContain('b.txt');
    });

    it('creates branches and tags, and finds them', async () => {
      const git = makeProvider();
      const { repository } = await repoIn(git);
      await git.createBranch({ token, id: repository.id, branch: 'work', ref: 'main' });
      const branch = await git.getBranch({ token, id: repository.id, branch: 'work' });
      expect(branch.name).toBe('work');
      await expect(git.createBranch({ token, id: repository.id, branch: 'work', ref: 'main', track: false }))
        .rejects.toSatisfy((error) => git.isAlreadyExistsError(error));

      await git.createTag({ token, id: repository.id, tag: 'v1.0.0', ref: 'main', message: 'Release' });
      expect((await git.getTag({ token, id: repository.id, tag: 'v1.0.0' }))?.name).toBe('v1.0.0');
      // the annotation comes back as it was written, and a tag without one has none
      expect((await git.getTag({ token, id: repository.id, tag: 'v1.0.0' }))?.message?.trim()).toBe('Release');
      await git.createTag({ token, id: repository.id, tag: 'v1.0.1', ref: 'main' })
      expect((await git.getTag({ token, id: repository.id, tag: 'v1.0.1' }))?.message ?? null).toBeNull()
      expect(await git.getTag({ token, id: repository.id, tag: 'v9.9.9' })).toBeNull();
      expect((await git.listTags({ token, id: repository.id })).map((t) => t.name)).toContain('v1.0.0');
    });

    it('compares two refs: the commits and the files `to` brought', async () => {
      const git = makeProvider();
      const { repository } = await repoIn(git);
      await git.createBranch({ token, id: repository.id, branch: 'feature', ref: 'main' });
      await git.commit({ token, id: repository.id, branch: 'feature', message: 'add compare', actions: [{ action: 'create', path: 'cmp.txt', content: 'x\n' }] });
      const result = await git.compare({ token, id: repository.id, from: 'main', to: 'feature' });
      expect(result.commits.map((c) => c.title)).toContain('add compare');
      expect(result.files.map((f) => f.newPath)).toContain('cmp.txt');
      expect(result.files.find((f) => f.newPath === 'cmp.txt')).toMatchObject({ status: 'added' });
      const none = await git.compare({ token, id: repository.id, from: 'feature', to: 'main' });
      expect(none.files).toEqual([]);
    });

    it('opens a change request, merges it, and finds it among the merged ones', async () => {
      const git = makeProvider();
      const { repository } = await repoIn(git);
      await git.createBranch({ token, id: repository.id, branch: 'feature', ref: 'main' });
      await git.commit({ token, id: repository.id, branch: 'feature', message: 'add', actions: [{ action: 'create', path: 'new.txt', content: 'x' }] });
      const request = await git.createChangeRequest({ token, id: repository.id, title: 'Add new', sourceBranch: 'feature', targetBranch: 'main' });
      expect(request).toMatchObject({ title: 'Add new', sourceBranch: 'feature', targetBranch: 'main' });
      expect(typeof request.number).toBe('number');

      const opened = await git.listChangeRequests({ token, id: repository.id, state: 'opened', targetBranch: 'main' });
      expect(opened.map((r) => r.number)).toContain(request.number);

      const conflicts = await git.mergeChangeRequest({ token, id: repository.id, number: request.number });
      expect(conflicts).toBe(false);
      expect(await git.listFiles({ token, id: repository.id, ref: 'main' })).toContain('new.txt');
      const merged = await git.listChangeRequests({ token, id: repository.id, state: 'merged', targetBranch: 'main' });
      expect(merged.map((r) => r.sourceBranch)).toContain('feature');
    });

    it('says a change request has conflicts, and leaves the target as it was', async () => {
      const git = makeProvider();
      const { repository } = await repoIn(git);
      await git.createFile({ token, id: repository.id, path: 'c.txt', branch: 'main', content: 'base' });
      await git.createBranch({ token, id: repository.id, branch: 'other', ref: 'main' });
      await git.commit({ token, id: repository.id, branch: 'other', message: 'theirs', actions: [{ action: 'update', path: 'c.txt', content: 'theirs' }] });
      await git.commit({ token, id: repository.id, branch: 'main', message: 'ours', actions: [{ action: 'update', path: 'c.txt', content: 'ours' }] });
      const request = await git.createChangeRequest({ token, id: repository.id, title: 'Clash', sourceBranch: 'other', targetBranch: 'main' });
      expect(await git.mergeChangeRequest({ token, id: repository.id, number: request.number })).toBe(true);
      expect((await git.readFile({ token, id: repository.id, path: 'c.txt', ref: 'main' })).toString('utf8')).toBe('ours');
      const [open] = await git.listChangeRequests({ token, id: repository.id, state: 'opened', targetBranch: 'main' });
      expect(open.hasConflicts).toBe(true);
    });

    it('renames a standing change request instead of opening a second one', async () => {
      const git = makeProvider();
      const { repository } = await repoIn(git);
      await git.createBranch({ token, id: repository.id, branch: 'bigbang', ref: 'main' });
      await git.commit({ token, id: repository.id, branch: 'bigbang', message: 'v1', actions: [{ action: 'create', path: 'v.txt', content: '1' }] });
      const first = await git.createOrRenameChangeRequest({ token, id: repository.id, title: 'Update to 1', sourceBranch: 'bigbang' });
      const second = await git.createOrRenameChangeRequest({ token, id: repository.id, title: 'Update to 2', sourceBranch: 'bigbang' });
      expect(second.number).toBe(first.number);
      const open = await git.listChangeRequests({ token, id: repository.id, state: 'opened' });
      expect(open.map((request) => request.title)).toEqual(['Update to 2']);
    });

    it('keeps or deletes the branch of a merged change request, as asked', async () => {
      const git = makeProvider();
      const { repository } = await repoIn(git);
      for (const [branch, deleteSourceBranch] of [['keep-me', false], ['delete-me', true]]) {
        await git.createBranch({ token, id: repository.id, branch, ref: 'main' });
        await git.commit({ token, id: repository.id, branch, message: branch, actions: [{ action: 'create', path: `${branch}.txt`, content: branch }] });
        const request = await git.createChangeRequest({ token, id: repository.id, title: branch, sourceBranch: branch, targetBranch: 'main' });
        expect(await git.mergeChangeRequest({ token, id: repository.id, number: request.number, deleteSourceBranch })).toBe(false);
      }
      expect((await git.getBranch({ token, id: repository.id, branch: 'keep-me' })).name).toBe('keep-me');
      await expect(git.getBranch({ token, id: repository.id, branch: 'delete-me' })).rejects.toMatchObject({ status: 404 });
    });

    it('has no pipeline for a branch that never ran one', async () => {
      const git = makeProvider();
      const { repository } = await repoIn(git);
      expect(await git.getLatestPipeline({ token, id: repository.id, ref: 'main' })).toBeNull();
    });

    it('lists the members with a numeric access level', async () => {
      const git = makeProvider();
      const { repository } = await repoIn(git);
      await addMember({ repository, username: 'dev', accessLevel: 40 });
      const members = await git.getMembers({ token, id: repository.id });
      expect(members).toContainEqual(expect.objectContaining({ username: 'dev', accessLevel: 40 }));
      for (const member of members) {
        expect(typeof member.username).toBe('string');
        expect(typeof member.accessLevel).toBe('number');
      }
    });

    it('gives, changes, lists and takes away the access of a person, and finds people to give it to', async () => {
      const git = makeProvider();
      const { repository } = await repoIn(git);
      await git.setAccess({ token, id: repository.id, username: 'ana', accessLevel: 30 });
      let access = await git.listAccess({ token, id: repository.id });
      expect(access).toContainEqual({ username: 'ana', accessLevel: 30, source: 'direct' });
      await git.setAccess({ token, id: repository.id, username: 'ana', accessLevel: 40 });
      access = await git.listAccess({ token, id: repository.id });
      expect(access.filter((entry) => entry.username === 'ana')).toEqual([{ username: 'ana', accessLevel: 40, source: 'direct' }]);
      await git.removeAccess({ token, id: repository.id, username: 'ana' });
      expect((await git.listAccess({ token, id: repository.id })).map((entry) => entry.username)).not.toContain('ana');
      const found = await git.searchUsers({ token, query: 'dev' });
      expect(Array.isArray(found)).toBe(true);
      for (const user of found) expect(typeof user.username).toBe('string');
    });

    it('knows a webhook delivery from its host by the secret, and reads which branch was pushed', async () => {
      const git = makeProvider();
      const delivery = signWebhook({ body: { ref: 'refs/heads/bigbang' }, secret: 's3cret' });
      expect(git.verifyWebhook({ headers: delivery.headers, rawBody: delivery.rawBody, secret: 's3cret' })).toBe(true);
      expect(git.verifyWebhook({ headers: delivery.headers, rawBody: delivery.rawBody, secret: 'wrong' })).toBe(false);
      expect(git.verifyWebhook({ headers: {}, rawBody: delivery.rawBody, secret: 's3cret' })).toBe(false);
      expect(git.parsePushEvent(pushEvent({ repositoryId: 7, branch: 'bigbang' }))).toEqual({ repositoryId: 7, branch: 'bigbang' });
      expect(git.parsePushEvent({ headers: {}, body: {} })).toBeNull();
    });

    it('registers a webhook once', async () => {
      const git = makeProvider();
      const { repository } = await repoIn(git);
      const args = { token, id: repository.id, url: 'https://linea.example/api/webhooks/x', secret: 's3cret' };
      expect((await git.ensureWebhook(args)).status).toBe('created');
      expect((await git.ensureWebhook(args)).status).toBe('already_exists');
    });

    it('downloads a zip of the repository', async () => {
      const git = makeProvider();
      const { repository } = await repoIn(git);
      const { buffer } = await import('node:stream/consumers');
      const bytes = await buffer(await git.downloadArchive({ token, id: repository.id, ref: 'main' }));
      expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    });

    describe('releases', () => {
      // a repository with a tag to make releases of
      const tagIn = async (git, tag = 'v1.0.0') => {
        const { repository } = await repoIn(git);
        await git.createTag({ token, id: repository.id, tag, ref: 'main', message: '{}' });
        return repository;
      };

      it('says what it can do', () => {
        expect(typeof makeProvider().capabilities().releases.prerelease).toBe('boolean');
      });

      it('creates a release of a tag and describes it in the neutral shape', async () => {
        const git = makeProvider();
        const repository = await tagIn(git);
        const made = await git.createRelease({ token, id: repository.id, tag: 'v1.0.0', name: 'First', description: '# Notes\n- one' });
        expect(made).toMatchObject({ tag: 'v1.0.0', name: 'First', description: '# Notes\n- one', prerelease: false });
        expect(typeof made.createdAt).toBe('string');
        expect(typeof made.url).toBe('string');
      });

      it('names the release after the tag when it is given no name', async () => {
        const git = makeProvider();
        const repository = await tagIn(git);
        expect(await git.createRelease({ token, id: repository.id, tag: 'v1.0.0' })).toMatchObject({ name: 'v1.0.0', description: '' });
      });

      it('reads a release, and says there is none when there is none', async () => {
        const git = makeProvider();
        const repository = await tagIn(git);
        expect(await git.getRelease({ token, id: repository.id, tag: 'v1.0.0' })).toBeNull();
        await git.createRelease({ token, id: repository.id, tag: 'v1.0.0', name: 'First' });
        expect(await git.getRelease({ token, id: repository.id, tag: 'v1.0.0' })).toMatchObject({ tag: 'v1.0.0', name: 'First' });
      });

      it('lists the releases, newest first', async () => {
        const git = makeProvider();
        const repository = await tagIn(git);
        expect(await git.listReleases({ token, id: repository.id })).toEqual([]);
        await git.createTag({ token, id: repository.id, tag: 'v1.1.0', ref: 'main', message: '{}' });
        await git.createRelease({ token, id: repository.id, tag: 'v1.0.0' });
        await git.createRelease({ token, id: repository.id, tag: 'v1.1.0' });
        expect((await git.listReleases({ token, id: repository.id })).map((release) => release.tag)).toEqual(['v1.1.0', 'v1.0.0']);
      });

      it('does not overwrite the release of a tag that has one', async () => {
        const git = makeProvider();
        const repository = await tagIn(git);
        await git.createRelease({ token, id: repository.id, tag: 'v1.0.0', name: 'First', description: 'original' });
        const error = await git.createRelease({ token, id: repository.id, tag: 'v1.0.0', name: 'Other', description: 'changed' }).catch((e) => e);
        expect(error).toBeInstanceOf(Error);
        expect(git.isAlreadyExistsError(error)).toBe(true);
        expect(await git.getRelease({ token, id: repository.id, tag: 'v1.0.0' })).toMatchObject({ name: 'First', description: 'original' });
      });

      it('updates a release, touching only what changes holds', async () => {
        const git = makeProvider();
        const repository = await tagIn(git);
        await git.createRelease({ token, id: repository.id, tag: 'v1.0.0', name: 'First', description: 'old' });
        const updated = await git.updateRelease({ token, id: repository.id, tag: 'v1.0.0', changes: { description: 'new' } });
        expect(updated).toMatchObject({ tag: 'v1.0.0', name: 'First', description: 'new' });
        expect(await git.getRelease({ token, id: repository.id, tag: 'v1.0.0' })).toMatchObject({ name: 'First', description: 'new' });
        const renamed = await git.updateRelease({ token, id: repository.id, tag: 'v1.0.0', changes: { name: 'Renamed' } });
        expect(renamed).toMatchObject({ name: 'Renamed', description: 'new' });
      });

      it('marks a prerelease where the host can', async () => {
        const git = makeProvider();
        const repository = await tagIn(git);
        const made = await git.createRelease({ token, id: repository.id, tag: 'v1.0.0', prerelease: true });
        expect(made.prerelease).toBe(git.capabilities().releases.prerelease);
        if (git.capabilities().releases.prerelease) {
          expect((await git.updateRelease({ token, id: repository.id, tag: 'v1.0.0', changes: { prerelease: false } })).prerelease).toBe(false);
        }
      });

      it('refuses a release of a tag that does not exist, or the update of one that was never made', async () => {
        const git = makeProvider();
        const repository = await tagIn(git);
        await expect(git.createRelease({ token, id: repository.id, tag: 'v9.9.9' })).rejects.toBeTruthy();
        expect(await git.getRelease({ token, id: repository.id, tag: 'v9.9.9' })).toBeNull();
        expect(await git.listReleases({ token, id: repository.id })).toEqual([]);
        await expect(git.updateRelease({ token, id: repository.id, tag: 'v1.0.0', changes: { name: 'x' } })).rejects.toMatchObject({ status: 404 });
      });
    });

    describe('issues', () => {
      const issueIn = async (git, fields = {}) => {
        const { repository } = await repoIn(git);
        return { repository, issue: await git.createIssue({ token, id: repository.id, title: 'It breaks', ...fields }) };
      };

      it('says what it can do', () => {
        const { issues } = makeProvider().capabilities();
        expect(typeof issues.labels).toBe('boolean');
        expect(typeof issues.milestones).toBe('boolean');
        expect(typeof issues.assignees).toBe('boolean');
        expect(typeof issues.closingWords).toBe('boolean');
      });

      it('closes the issues a merged request names with a closing word, when the provider does it (the other hosts do it themselves)', async () => {
        const git = makeProvider();
        if (!git.capabilities().issues.closingWords) return;
        const { repository } = await repoIn(git);
        const id = repository.id;
        const [first, second, third] = [1, 2, 3].map((n) => `Problem ${n}`);
        for (const title of [first, second, third]) await git.createIssue({ token, id, title });
        await git.createBranch({ token, id, branch: 'feature', ref: 'main' });
        await git.commit({ token, id, branch: 'feature', message: 'work\n\nFixes #2', actions: [{ action: 'create', path: 'a.txt', content: 'a' }] });
        const request = await git.createMergeRequest({ token, id, title: 'Add a', description: 'Closes #1 and mentions #3', sourceBranch: 'feature', targetBranch: 'main' });
        expect((await git.getIssue({ token, id, number: 1 })).state).toBe('opened');
        await git.mergeMergeRequest({ token, id, number: request.number });
        expect((await git.getIssue({ token, id, number: 1 })).state).toBe('closed');
        expect((await git.getIssue({ token, id, number: 2 })).state).toBe('closed');
        expect((await git.getIssue({ token, id, number: 3 })).state).toBe('opened');
      });

      it('leaves the issues alone when the request merges into a branch that is not the default one', async () => {
        const git = makeProvider();
        if (!git.capabilities().issues.closingWords) return;
        const { repository } = await repoIn(git);
        const id = repository.id;
        await git.createIssue({ token, id, title: 'Problem' });
        await git.createBranch({ token, id, branch: 'staging', ref: 'main' });
        await git.createBranch({ token, id, branch: 'feature', ref: 'main' });
        await git.commit({ token, id, branch: 'feature', message: 'work', actions: [{ action: 'create', path: 'a.txt', content: 'a' }] });
        const request = await git.createMergeRequest({ token, id, title: 'Closes #1', sourceBranch: 'feature', targetBranch: 'staging' });
        await git.mergeMergeRequest({ token, id, number: request.number });
        expect((await git.getIssue({ token, id, number: 1 })).state).toBe('opened');
      });

      it('creates an issue and describes it in the neutral shape', async () => {
        const git = makeProvider();
        const { repository } = await repoIn(git);
        await addMilestone?.({ repository, title: 'v1' });
        const made = await git.createIssue({ token, id: repository.id, title: 'It breaks', description: '# Steps\n1. Click', labels: ['bug', 'ui'], assignees: ['maria'], milestone: 'v1' });
        expect(made).toMatchObject({ number: 1, title: 'It breaks', description: '# Steps\n1. Click', state: 'opened', assignees: ['maria'], milestone: 'v1', closedAt: null, commentCount: 0 });
        expect([...made.labels].sort()).toEqual(['bug', 'ui']);
        expect(typeof made.author).toBe('string');
        expect(typeof made.createdAt).toBe('string');
        expect(typeof made.webUrl).toBe('string');
        expect(await git.getIssue({ token, id: repository.id, number: made.number })).toMatchObject({ number: 1, title: 'It breaks' });
      });

      it('numbers the issues of a repository one after another', async () => {
        const git = makeProvider();
        const { repository, issue } = await issueIn(git);
        const next = await git.createIssue({ token, id: repository.id, title: 'Another' });
        expect(next.number).toBeGreaterThan(issue.number);
      });

      it('has no issue where there is none', async () => {
        const git = makeProvider();
        const { repository } = await repoIn(git);
        await expect(git.getIssue({ token, id: repository.id, number: 99 })).rejects.toMatchObject({ status: 404 });
      });

      it('lists the open ones, newest first, and filters them', async () => {
        const git = makeProvider();
        const { repository } = await repoIn(git);
        await addMilestone?.({ repository, title: 'v1' });
        const id = repository.id;
        const first = await git.createIssue({ token, id, title: 'Slow login', description: 'takes ages', labels: ['bug'], assignees: ['maria'], milestone: 'v1' });
        const second = await git.createIssue({ token, id, title: 'Add dark mode', labels: ['feature'] });
        const third = await git.createIssue({ token, id, title: 'Crash on save', labels: ['bug'] });
        await git.updateIssue({ token, id, number: third.number, changes: { state: 'closed' } });
        const numbers = async (filter) => (await git.listIssues({ token, id, filter })).items.map((i) => i.number);
        expect(await numbers({})).toEqual([second.number, first.number]);
        expect(await numbers({ state: 'closed' })).toEqual([third.number]);
        expect(await numbers({ state: 'all' })).toEqual([third.number, second.number, first.number]);
        expect(await numbers({ state: 'all', labels: ['bug'] })).toEqual([third.number, first.number]);
        expect(await numbers({ assignee: 'maria' })).toEqual([first.number]);
        expect(await numbers({ milestone: 'v1' })).toEqual([first.number]);
        expect(await numbers({ author: 'nobody-wrote-this' })).toEqual([]);
        expect(await numbers({ search: 'dark' })).toEqual([second.number]);
        expect(await numbers({ search: 'ages' })).toEqual([first.number]);
      });

      it('pages a list', async () => {
        const git = makeProvider();
        const { repository } = await repoIn(git);
        for (const title of ['a', 'b', 'c']) await git.createIssue({ token, id: repository.id, title });
        const one = await git.listIssues({ token, id: repository.id, filter: { perPage: 2 } });
        expect(one.items.map((i) => i.title)).toEqual(['c', 'b']);
        expect(one).toMatchObject({ page: 1, perPage: 2, hasMore: true });
        const two = await git.listIssues({ token, id: repository.id, filter: { perPage: 2, page: 2 } });
        expect(two.items.map((i) => i.title)).toEqual(['a']);
        expect(two.hasMore).toBe(false);
      });

      it('edits an issue, closes it and opens it again, touching only what it is told', async () => {
        const git = makeProvider();
        const { repository, issue } = await issueIn(git, { description: 'before', labels: ['bug'] });
        const id = repository.id;
        const edited = await git.updateIssue({ token, id, number: issue.number, changes: { title: 'Renamed', labels: ['bug', 'urgent'], assignees: ['maria'] } });
        expect(edited).toMatchObject({ title: 'Renamed', description: 'before', assignees: ['maria'] });
        expect([...edited.labels].sort()).toEqual(['bug', 'urgent']);
        const closed = await git.updateIssue({ token, id, number: issue.number, changes: { state: 'closed' } });
        expect(closed.state).toBe('closed');
        expect(closed.closedAt).not.toBeNull();
        const reopened = await git.updateIssue({ token, id, number: issue.number, changes: { state: 'opened' } });
        expect(reopened).toMatchObject({ state: 'opened', closedAt: null, title: 'Renamed' });
        const cleared = await git.updateIssue({ token, id, number: issue.number, changes: { description: '', labels: [], assignees: [] } });
        expect(cleared).toMatchObject({ description: '', labels: [], assignees: [] });
      });

      it('keeps the thread of an issue in order', async () => {
        const git = makeProvider();
        const { repository, issue } = await issueIn(git);
        const id = repository.id;
        expect(await git.listIssueComments({ token, id, number: issue.number })).toEqual([]);
        const first = await git.addIssueComment({ token, id, number: issue.number, body: 'I can reproduce it' });
        await git.addIssueComment({ token, id, number: issue.number, body: 'Fixed in the next version' });
        expect(first).toMatchObject({ body: 'I can reproduce it' });
        expect(typeof first.author).toBe('string');
        const thread = await git.listIssueComments({ token, id, number: issue.number });
        expect(thread.map((c) => c.body)).toEqual(['I can reproduce it', 'Fixed in the next version']);
        expect((await git.getIssue({ token, id, number: issue.number })).commentCount).toBe(2);
      });

      it('tells who put each label on an issue and took it off, and when', async () => {
        const git = makeProvider();
        const { repository } = await repoIn(git);
        const id = repository.id;
        const issue = await git.createIssue({ token, id, title: 'Dark mode', labels: ['feature'] });
        await git.updateIssue({ token, id, number: issue.number, changes: { labels: ['feature', 'agent::evolve'] } });
        await git.updateIssue({ token, id, number: issue.number, changes: { labels: ['agent::evolve'] } });
        const events = await git.listIssueLabelEvents({ token, id, number: issue.number });
        expect(events.map((e) => `${e.action} ${e.label}`)).toEqual(['added feature', 'added agent::evolve', 'removed feature']);
        expect(typeof events[0].author).toBe('string');
        expect(typeof events[0].createdAt).toBe('string');
      });

      it('lists the labels and the milestones to choose from', async () => {
        const git = makeProvider();
        const { repository } = await repoIn(git);
        await addMilestone?.({ repository, title: 'v1' });
        await git.createIssue({ token, id: repository.id, title: 'x', labels: ['bug'], milestone: 'v1' });
        expect(Array.isArray(await git.listLabels({ token, id: repository.id }))).toBe(true);
        expect((await git.listMilestones({ token, id: repository.id })).map((m) => m.title)).toContain('v1');
      });
    });

    describe('templates', () => {
      const place = {
        gitlab: { issue: '.gitlab/issue_templates/bug.md', mergeRequest: '.gitlab/merge_request_templates/feature.md' },
        github: { issue: '.github/ISSUE_TEMPLATE/bug.md', mergeRequest: '.github/pull_request_template.md' }
      };

      const withTemplates = async (git) => {
        const { repository } = await repoIn(git);
        const id = repository.id;
        if (git.kind === 'local') {
          await git.saveTemplate({ token, id, kind: 'issue', name: 'bug', content: '## Steps\n1.' });
          await git.saveTemplate({ token, id, kind: 'mergeRequest', name: 'feature', content: '## What changes' });
        } else {
          await git.createFile({ token, id, path: place[git.kind].issue, branch: 'main', content: '## Steps\n1.' });
          await git.createFile({ token, id, path: place[git.kind].mergeRequest, branch: 'main', content: '## What changes' });
        }
        return id;
      };

      it('says whether they can be edited', () => {
        expect(typeof makeProvider().capabilities().templates.editable).toBe('boolean');
      });

      it('has none where nobody wrote any', async () => {
        const git = makeProvider();
        const { repository } = await repoIn(git);
        expect(await git.listTemplates({ token, id: repository.id, kind: 'issue' })).toEqual([]);
        expect(await git.listTemplates({ token, id: repository.id, kind: 'mergeRequest' })).toEqual([]);
      });

      it('lists the ones of the issues and the ones of the merge requests apart', async () => {
        const git = makeProvider();
        const id = await withTemplates(git);
        const [issue] = await git.listTemplates({ token, id, kind: 'issue' });
        const [request] = await git.listTemplates({ token, id, kind: 'mergeRequest' });
        expect(issue.content).toBe('## Steps\n1.');
        expect(request.content).toBe('## What changes');
        expect(typeof issue.name).toBe('string');
        expect(issue.name).not.toBe(request.name);
      });

      it('is edited where the host keeps them in its own bookkeeping, and refused where they are files', async () => {
        const git = makeProvider();
        const { repository } = await repoIn(git);
        const id = repository.id;
        if (!git.capabilities().templates.editable) {
          await expect(git.saveTemplate({ token, id, kind: 'issue', name: 'x', content: 'y' })).rejects.toMatchObject({ status: 400 });
          return;
        }
        await git.saveTemplate({ token, id, kind: 'issue', name: 'bug', content: 'one' });
        await git.saveTemplate({ token, id, kind: 'issue', name: 'bug', content: 'two' });
        await git.saveTemplate({ token, id, kind: 'issue', name: 'idea', content: 'three' });
        expect(await git.listTemplates({ token, id, kind: 'issue' })).toEqual([{ name: 'bug', content: 'two' }, { name: 'idea', content: 'three' }]);
        await git.deleteTemplate({ token, id, kind: 'issue', name: 'bug' });
        expect((await git.listTemplates({ token, id, kind: 'issue' })).map((template) => template.name)).toEqual(['idea']);
        await expect(git.deleteTemplate({ token, id, kind: 'issue', name: 'bug' })).rejects.toMatchObject({ status: 404 });
        await expect(git.saveTemplate({ token, id, kind: 'issue', name: ' ', content: 'x' })).rejects.toMatchObject({ status: 400 });
      });
    });

    describe('merge requests', () => {
      // a repository with a branch that adds one file and changes another
      const requestIn = async (git, fields = {}) => {
        const { repository } = await repoIn(git);
        const id = repository.id;
        await git.createBranch({ token, id, branch: 'feature', ref: 'main' });
        await git.commit({ token, id, branch: 'feature', message: 'work', actions: [{ action: 'create', path: 'docs/a.md', content: 'line one\nline two\n' }] });
        const request = await git.createMergeRequest({ token, id, title: 'Add the docs', description: '# Why\nBecause.', sourceBranch: 'feature', targetBranch: 'main', ...fields });
        return { id, request };
      };

      it('says what it can do', () => {
        const { mergeRequests } = makeProvider().capabilities();
        for (const key of ['labels', 'reviewers', 'approvals', 'resolvableThreads', 'squash']) expect(typeof mergeRequests[key], key).toBe('boolean');
      });

      it('lists the branches of the repository', async () => {
        const git = makeProvider();
        const { id } = await requestIn(git);
        const names = await git.listBranches({ token, id });
        expect(names).toContain('main');
        expect(names).toContain('feature');
      });

      it('opens one and describes it in the neutral shape', async () => {
        const git = makeProvider();
        const { id, request } = await requestIn(git, { labels: ['bug'] });
        expect(request).toMatchObject({ title: 'Add the docs', description: '# Why\nBecause.', state: 'opened', sourceBranch: 'feature', targetBranch: 'main', hasConflicts: false, mergedAt: null });
        expect(typeof request.number).toBe('number');
        expect(typeof request.author).toBe('string');
        expect(typeof request.createdAt).toBe('string');
        expect(request.labels).toEqual(['bug']);
        expect(await git.getMergeRequest({ token, id, number: request.number })).toMatchObject({ number: request.number, title: 'Add the docs' });
        await expect(git.getMergeRequest({ token, id, number: 999 })).rejects.toMatchObject({ status: 404 });
      });

      it('lists them, newest first, narrowed by state, text, label and branches, a page at a time', async () => {
        const git = makeProvider();
        const { id, request } = await requestIn(git, { labels: ['bug'] });
        await git.createBranch({ token, id, branch: 'other', ref: 'main' });
        await git.commit({ token, id, branch: 'other', message: 'more', actions: [{ action: 'create', path: 'b.txt', content: 'b' }] });
        const second = await git.createMergeRequest({ token, id, title: 'Another change', sourceBranch: 'other', targetBranch: 'main' });
        const numbers = async (filter) => (await git.listMergeRequests({ token, id, filter })).items.map((r) => r.number);
        expect(await numbers({})).toEqual([second.number, request.number]);
        expect(await numbers({ state: 'merged' })).toEqual([]);
        expect(await numbers({ search: 'docs' })).toEqual([request.number]);
        expect(await numbers({ labels: ['bug'] })).toEqual([request.number]);
        expect(await numbers({ sourceBranch: 'other' })).toEqual([second.number]);
        expect(await numbers({ targetBranch: 'main' })).toEqual([second.number, request.number]);
        const first = await git.listMergeRequests({ token, id, filter: { perPage: 1 } });
        expect(first).toMatchObject({ page: 1, perPage: 1, hasMore: true });
        expect((await git.listMergeRequests({ token, id, filter: { perPage: 1, page: 2 } })).items.map((r) => r.number)).toEqual([request.number]);
      });

      it('shows the code it proposes, file by file, with the lines it adds', async () => {
        const git = makeProvider();
        const { id, request } = await requestIn(git);
        const files = await git.getMergeRequestDiff({ token, id, number: request.number });
        const added = files.find((file) => file.newPath === 'docs/a.md');
        expect(added).toMatchObject({ status: 'added', additions: 2, deletions: 0 });
        expect(added.patch).toContain('+line one');
        expect(added.patch).toContain('+line two');
      });

      it('keeps the conversations: a general message, one about a line, the answers, and resolving the ones about code', async () => {
        const git = makeProvider();
        const { id, request } = await requestIn(git);
        const number = request.number;
        const general = await git.addMergeRequestComment({ token, id, number, body: 'Looks fine overall' });
        expect(general.position).toBeUndefined();
        expect(general.comments.map((c) => c.body)).toEqual(['Looks fine overall']);
        const online = await git.addMergeRequestComment({ token, id, number, body: 'Why this word?', position: { path: 'docs/a.md', line: 2, side: 'new' } });
        expect(online.position).toEqual({ path: 'docs/a.md', line: 2, side: 'new' });
        const answered = await git.addMergeRequestComment({ token, id, number, body: 'To be clearer', threadId: online.id });
        expect(answered.comments.map((c) => c.body)).toEqual(['Why this word?', 'To be clearer']);
        const threads = await git.listMergeRequestThreads({ token, id, number });
        expect(threads).toHaveLength(2);
        expect(threads.find((t) => t.position)?.comments).toHaveLength(2);
        expect((await git.getMergeRequest({ token, id, number })).commentCount).toBeGreaterThanOrEqual(3);
        if (git.capabilities().mergeRequests.resolvableThreads) {
          expect(threads.find((t) => t.position)?.resolvable).toBe(true);
          expect((await git.setThreadResolved({ token, id, number, threadId: online.id, resolved: true })).resolved).toBe(true);
          expect((await git.listMergeRequestThreads({ token, id, number })).find((t) => t.position)?.resolved).toBe(true);
          expect((await git.setThreadResolved({ token, id, number, threadId: online.id, resolved: false })).resolved).toBe(false);
        } else {
          await expect(git.setThreadResolved({ token, id, number, threadId: online.id, resolved: true })).rejects.toMatchObject({ status: 400 });
        }
      });

      it('edits one, closes it and opens it again, touching only what it is told', async () => {
        const git = makeProvider();
        const { id, request } = await requestIn(git);
        const number = request.number;
        const edited = await git.updateMergeRequest({ token, id, number, changes: { title: 'Renamed', description: 'New text' } });
        expect(edited).toMatchObject({ title: 'Renamed', description: 'New text', state: 'opened' });
        const labelled = await git.updateMergeRequest({ token, id, number, changes: { labels: ['bug', 'ui'], reviewers: ['maria'] } });
        expect([...labelled.labels].sort()).toEqual(['bug', 'ui']);
        expect(labelled.reviewers).toEqual(['maria']);
        expect(labelled.title).toBe('Renamed');
        expect((await git.updateMergeRequest({ token, id, number, changes: { state: 'closed' } })).state).toBe('closed');
        expect((await git.listMergeRequests({ token, id, filter: { state: 'closed' } })).items.map((r) => r.number)).toEqual([number]);
        expect((await git.updateMergeRequest({ token, id, number, changes: { state: 'opened' } })).state).toBe('opened');
      });

      it('takes an approval where the host has approvals, and says no where it has none', async () => {
        const git = makeProvider();
        const { id, request } = await requestIn(git);
        if (git.capabilities().mergeRequests.approvals) {
          await git.approveMergeRequest({ token, id, number: request.number });
          expect((await git.getMergeRequest({ token, id, number: request.number })).approvals?.given).toHaveLength(1);
        } else {
          await expect(git.approveMergeRequest({ token, id, number: request.number })).rejects.toMatchObject({ status: 400 });
        }
      });

      it('merges it as one commit when asked to squash, and takes the branch away when asked to', async () => {
        const git = makeProvider();
        const { id, request } = await requestIn(git);
        await git.commit({ token, id, branch: 'feature', message: 'second', actions: [{ action: 'create', path: 'docs/b.md', content: 'two' }] });
        expect(await git.mergeMergeRequest({ token, id, number: request.number, options: { squash: true, deleteSourceBranch: true } })).toBe(false);
        const files = await git.listFiles({ token, id, ref: 'main' });
        expect(files).toContain('docs/a.md');
        expect(files).toContain('docs/b.md');
        expect((await git.getMergeRequest({ token, id, number: request.number })).state).toBe('merged');
        expect((await git.listMergeRequests({ token, id, filter: { state: 'merged' } })).items.map((r) => r.number)).toEqual([request.number]);
        await expect(git.getBranch({ token, id, branch: 'feature' })).rejects.toBeDefined();
      });
    });

    it('undoes what it created on rollback, newest first', async () => {
      const git = makeProvider();
      const { repository } = await repoIn(git, { repoName: 'Gone' });
      expect((await git.listRepositories({ token, topic: 'product' })).map((r) => r.id)).toContain(repository.id);
      await git.rollback();
      const left = await makeProvider().listRepositories({ token, topic: 'product' });
      expect(left.map((r) => r.id)).not.toContain(repository.id);
    });
  });
};
