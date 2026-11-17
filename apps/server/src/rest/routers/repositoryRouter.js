import express from 'express';
import { Container } from 'typedi';
import { requireAuth } from '../common/auth.js';
import RepositoryController from '../controllers/RepositoryController.js';
import {
  repositoryTargetValidator, createBranchValidator, repositoryBranchValidator, repositoryCommitsValidator, repositoryCommitValidator, repositoryCompareValidator, repositoryFileValidator, repositoryRefValidator
} from '../validators/repositoryValidators.js';

const controller = Container.get(RepositoryController);

/** The code of the repository of a line (`kind` 'line'), of a product ('product') or by the repository's own id ('repo', with `?host=`): mounted under `/:id/repo` of each, and `/api/repos/:id`. */
export default (kind) => {
  const router = express.Router({ mergeParams: true });
  router.use((req, _res, next) => { req.repositoryKind = kind; next(); });
  router.use(repositoryTargetValidator);
  router.get('/', requireAuth, controller.info);
  router.get('/branches', requireAuth, controller.listBranches);
  router.post('/branches', requireAuth, createBranchValidator, controller.createBranch);
  router.get('/branch', requireAuth, repositoryBranchValidator, controller.getBranch);
  router.get('/files', requireAuth, repositoryRefValidator, controller.listFiles);
  router.get('/file', requireAuth, repositoryFileValidator, controller.getFile);
  router.get('/archive', requireAuth, repositoryRefValidator, controller.archive);
  router.get('/commits', requireAuth, repositoryCommitsValidator, controller.listCommits);
  router.get('/compare', requireAuth, repositoryCompareValidator, controller.compare);
  router.post('/push-hook', requireAuth, controller.pushHook);
  router.post('/commits', requireAuth, repositoryCommitValidator, controller.commit);
  return router;
};
