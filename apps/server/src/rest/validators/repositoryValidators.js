import { body, query } from 'express-validator';
import { enabledHosts } from '../../model/git/index.js';
import handleValidationErrors from './commonValidationHandler.js';

const bad = 'error_messages.internal_error';
// (a name that starts with `-` would be taken by git for an option)
const text = (field, place = body, max = 255, ref = true) => {
  const rule = place(field).isString().trim().notEmpty().isLength({ max });
  return (ref ? rule.not().matches(/^-|\0/) : rule.not().matches(/\0/)).withMessage(bad);
};

/** The repository named by `:id` (a line or a product id, or the host's own id) and the host it is on. */
export const repositoryTargetValidator = [
  query('host').optional().isString().custom((value) => enabledHosts().includes(value)).withMessage('error_messages.git_host_validation'),
  handleValidationErrors
];

export const repositoryRefValidator = [text('ref', query), handleValidationErrors];
export const repositoryBranchValidator = [text('name', query), handleValidationErrors];
export const repositoryFileValidator = [text('path', query, 1024, false), text('ref', query), handleValidationErrors];
export const repositoryCommitsValidator = [text('ref', query), query('perPage').optional().isInt({ min: 1, max: 100 }).withMessage(bad), handleValidationErrors];
export const repositoryCompareValidator = [text('from', query), text('to', query), handleValidationErrors];
export const createBranchValidator = [text('branch'), text('ref'), handleValidationErrors];
export const repositoryCommitValidator = [
  text('branch'), text('message', body, 10000, false),
  body('actions').isArray({ min: 1, max: 500 }).withMessage(bad),
  body('actions.*.action').isIn(['create', 'update', 'delete']).withMessage(bad),
  body('actions.*.path').isString().notEmpty().isLength({ max: 1024 }).not().matches(/^\/|(^|\/)\.\.(\/|$)|\0/).withMessage(bad),
  body('actions.*.content').optional().isString().withMessage(bad),
  body('actions.*.encoding').optional().isIn(['text', 'base64']).withMessage(bad),
  body('actions.*.expectedRevision').optional().isString().withMessage(bad),
  handleValidationErrors
];
