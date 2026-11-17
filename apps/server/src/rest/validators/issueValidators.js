import { body, param, query } from 'express-validator';
import handleValidationErrors from './commonValidationHandler.js';

const textList = (field) => body(field).optional().isArray({ max: 50 }).withMessage('error_messages.internal_error')
  .bail().custom((list) => list.every((item) => typeof item === 'string' && item.length <= 100)).withMessage('error_messages.internal_error');

export const issueListValidator = [
  query('state').optional().isIn(['opened', 'closed', 'all']).withMessage('error_messages.internal_error'),
  query('page').optional().isInt({ min: 1 }).withMessage('error_messages.internal_error'),
  query('perPage').optional().isInt({ min: 1, max: 100 }).withMessage('error_messages.internal_error'),
  query('search').optional().isString().isLength({ max: 200 }).withMessage('error_messages.internal_error'),
  handleValidationErrors
];

export const issueNumberValidator = [
  param('number').isInt({ min: 1 }).withMessage('error_messages.internal_error'),
  handleValidationErrors
];

export const createIssueValidator = [
  body('title').isString().trim().notEmpty().isLength({ max: 255 }).withMessage('error_messages.issue_title_validation'),
  body('description').optional().isString().isLength({ max: 100000 }).withMessage('error_messages.internal_error'),
  textList('labels'),
  textList('assignees'),
  body('milestone').optional({ nullable: true }).isString().isLength({ max: 100 }).withMessage('error_messages.internal_error'),
  handleValidationErrors
];

export const updateIssueValidator = [
  param('number').isInt({ min: 1 }).withMessage('error_messages.internal_error'),
  body('title').optional().isString().trim().notEmpty().isLength({ max: 255 }).withMessage('error_messages.issue_title_validation'),
  body('description').optional().isString().isLength({ max: 100000 }).withMessage('error_messages.internal_error'),
  textList('labels'),
  textList('assignees'),
  body('milestone').optional({ nullable: true }).isString().isLength({ max: 100 }).withMessage('error_messages.internal_error'),
  body('state').optional().isIn(['opened', 'closed']).withMessage('error_messages.internal_error'),
  handleValidationErrors
];

export const issueCommentValidator = [
  param('number').isInt({ min: 1 }).withMessage('error_messages.internal_error'),
  body('body').isString().trim().notEmpty().isLength({ max: 100000 }).withMessage('error_messages.issue_comment_validation'),
  handleValidationErrors
];
