import { body, param, query } from 'express-validator';
import handleValidationErrors from './commonValidationHandler.js';

const textList = (field) => body(field).optional().isArray({ max: 50 }).withMessage('error_messages.internal_error')
  .bail().custom((list) => list.every((item) => typeof item === 'string' && item.length <= 100)).withMessage('error_messages.internal_error');
const number = param('number').isInt({ min: 1 }).withMessage('error_messages.internal_error');

export const mergeRequestListValidator = [
  query('state').optional().isIn(['opened', 'merged', 'closed', 'all']).withMessage('error_messages.internal_error'),
  query('origin').optional().isIn(['all', 'manual', 'sync', 'generation']).withMessage('error_messages.internal_error'),
  query('page').optional().isInt({ min: 1 }).withMessage('error_messages.internal_error'),
  query('perPage').optional().isInt({ min: 1, max: 100 }).withMessage('error_messages.internal_error'),
  query('search').optional().isString().isLength({ max: 200 }).withMessage('error_messages.internal_error'),
  handleValidationErrors
];
export const mergeRequestNumberValidator = [number, handleValidationErrors];
export const createMergeRequestValidator = [
  body('title').isString().trim().notEmpty().isLength({ max: 255 }).withMessage('error_messages.issue_title_validation'),
  body('description').optional().isString().isLength({ max: 100000 }).withMessage('error_messages.internal_error'),
  body('sourceBranch').isString().trim().notEmpty().isLength({ max: 255 }).withMessage('error_messages.internal_error'),
  body('targetBranch').isString().trim().notEmpty().isLength({ max: 255 }).withMessage('error_messages.internal_error'),
  textList('labels'), textList('reviewers'),
  handleValidationErrors
];
export const updateMergeRequestValidator = [
  number,
  body('title').optional().isString().trim().notEmpty().isLength({ max: 255 }).withMessage('error_messages.issue_title_validation'),
  body('description').optional().isString().isLength({ max: 100000 }).withMessage('error_messages.internal_error'),
  textList('labels'), textList('reviewers'),
  body('state').optional().isIn(['opened', 'closed']).withMessage('error_messages.internal_error'),
  handleValidationErrors
];
export const mergeRequestCommentValidator = [
  number,
  body('body').isString().trim().notEmpty().isLength({ max: 100000 }).withMessage('error_messages.issue_comment_validation'),
  body('position').optional().isObject().withMessage('error_messages.internal_error'),
  body('position.path').if(body('position').exists()).isString().notEmpty().withMessage('error_messages.internal_error'),
  body('position.line').if(body('position').exists()).isInt({ min: 1 }).withMessage('error_messages.internal_error'),
  body('position.side').if(body('position').exists()).isIn(['new', 'old']).withMessage('error_messages.internal_error'),
  body('threadId').optional().custom((value) => typeof value === 'string' || Number.isInteger(value)).withMessage('error_messages.internal_error'),
  handleValidationErrors
];
export const resolveThreadValidator = [
  number,
  param('threadId').isString().notEmpty().withMessage('error_messages.internal_error'),
  body('resolved').isBoolean().withMessage('error_messages.internal_error'),
  handleValidationErrors
];
export const mergeValidator = [
  number,
  body('squash').optional().isBoolean().withMessage('error_messages.internal_error'),
  body('deleteSourceBranch').optional().isBoolean().withMessage('error_messages.internal_error'),
  body('message').optional().isString().isLength({ max: 5000 }).withMessage('error_messages.internal_error'),
  handleValidationErrors
];
