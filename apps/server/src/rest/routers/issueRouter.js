import express from 'express';
import { Container } from 'typedi';
import { requireAuth } from '../common/auth.js';
import IssueController from '../controllers/IssueController.js';
import { templateNameValidator, templateValidator } from '../validators/templateValidators.js';
import {
  createIssueValidator, issueCommentValidator, issueListValidator, issueNumberValidator, updateIssueValidator
} from '../validators/issueValidators.js';

const controller = Container.get(IssueController);

/** The issues of the repository of a line (`kind` 'line') or of a product ('product'): mounted under `/:id/issues` of each. */
export default (kind) => {
  const router = express.Router({ mergeParams: true });
  router.use((req, _res, next) => { req.issueKind = kind; next(); });
  router.get('/', requireAuth, issueListValidator, controller.list);
  router.post('/', requireAuth, createIssueValidator, controller.create);
  // Must stay above '/:number'.
  router.get('/meta', requireAuth, controller.getMeta);
  router.put('/templates/:name', requireAuth, templateValidator, controller.saveTemplate);
  router.delete('/templates/:name', requireAuth, templateNameValidator, controller.deleteTemplate);
  router.get('/:number', requireAuth, issueNumberValidator, controller.get);
  router.patch('/:number', requireAuth, updateIssueValidator, controller.update);
  router.get('/:number/comments', requireAuth, issueNumberValidator, controller.listComments);
  router.post('/:number/comments', requireAuth, issueCommentValidator, controller.addComment);
  // the labels put on it and taken off it: who and when
  router.get('/:number/label-events', requireAuth, issueNumberValidator, controller.listLabelEvents);
  return router;
};
