import { body, query } from 'express-validator';
import handleValidationErrors from './commonValidationHandler.js';

export const notificationListValidator = [
  query('unread').optional().isIn(['true', 'false']).withMessage('error_messages.internal_error'),
  query('page').optional().isInt({ min: 1 }).withMessage('error_messages.internal_error'),
  handleValidationErrors
];

export const createNotificationValidator = [
  body('subject').isIn(['issue', 'mr']).withMessage('error_messages.internal_error'),
  body('target.kind').isIn(['line', 'product']).withMessage('error_messages.internal_error'),
  body('target.id').isString().isLength({ min: 1, max: 40 }).withMessage('error_messages.internal_error'),
  body('target.name').optional().isString().isLength({ max: 200 }).withMessage('error_messages.internal_error'),
  body('number').isInt({ min: 1 }).withMessage('error_messages.internal_error'),
  body('title').optional().isString().isLength({ max: 300 }).withMessage('error_messages.internal_error'),
  body('actor').optional().isString().isLength({ max: 80 }).withMessage('error_messages.internal_error'),
  body('excerpt').optional().isString().isLength({ max: 2000 }).withMessage('error_messages.internal_error'),
  handleValidationErrors
];

export const markReadValidator = [
  body('ids').optional().isArray({ max: 200 }).withMessage('error_messages.internal_error')
    .bail().custom((ids) => ids.every((id) => typeof id === 'string' && id.length <= 40)).withMessage('error_messages.internal_error'),
  handleValidationErrors
];

export const rulesValidator = [
  body('failed').optional().isBoolean().withMessage('error_messages.internal_error'),
  body('conflicts').optional().isBoolean().withMessage('error_messages.internal_error'),
  body('stuck').optional().isBoolean().withMessage('error_messages.internal_error'),
  body('stuckMinutes').optional().isInt({ min: 5, max: 1440 }).withMessage('error_messages.internal_error'),
  body('lineIds').optional().isArray({ max: 200 }).withMessage('error_messages.internal_error'),
  handleValidationErrors
];
