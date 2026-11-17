import express from 'express';
import { Container } from 'typedi';
import { requireAuth } from '../common/auth.js';
import MergeRequestController from '../controllers/MergeRequestController.js';
import { repositoryTargetValidator } from '../validators/repositoryValidators.js';
import { templateNameValidator, templateValidator } from '../validators/templateValidators.js';
import {
  createMergeRequestValidator, mergeRequestCommentValidator, mergeRequestListValidator, mergeRequestNumberValidator, mergeValidator,
  resolveThreadValidator, updateMergeRequestValidator
} from '../validators/mergeRequestValidators.js';

const controller = Container.get(MergeRequestController);

/** The merge requests of the repository of a line (`kind` 'line') or of a product ('product'): mounted under `/:id/mrs` of each. */
export default (kind) => {
  const router = express.Router({ mergeParams: true });
  router.use((req, _res, next) => { req.mergeRequestKind = kind; next(); });
  router.use(repositoryTargetValidator);
  router.get('/', requireAuth, mergeRequestListValidator, controller.list);
  router.post('/', requireAuth, createMergeRequestValidator, controller.create);
  // Must stay above '/:number'.
  router.get('/meta', requireAuth, controller.getMeta);
  router.put('/templates/:name', requireAuth, templateValidator, controller.saveTemplate);
  router.delete('/templates/:name', requireAuth, templateNameValidator, controller.deleteTemplate);
  router.get('/:number', requireAuth, mergeRequestNumberValidator, controller.get);
  router.patch('/:number', requireAuth, updateMergeRequestValidator, controller.update);
  router.get('/:number/diff', requireAuth, mergeRequestNumberValidator, controller.diff);
  router.get('/:number/threads', requireAuth, mergeRequestNumberValidator, controller.threads);
  router.post('/:number/threads', requireAuth, mergeRequestCommentValidator, controller.comment);
  router.put('/:number/threads/:threadId/resolved', requireAuth, resolveThreadValidator, controller.resolve);
  router.post('/:number/merge', requireAuth, mergeValidator, controller.merge);
  router.post('/:number/approve', requireAuth, mergeRequestNumberValidator, controller.approve);
  return router;
};
