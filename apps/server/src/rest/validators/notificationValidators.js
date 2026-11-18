import { body, query } from 'express-validator';
import handleValidationErrors from './commonValidationHandler.js';

export const notificationListValidator = [
  query('unread').optional().isIn(['true', 'false']).withMessage('error_messages.internal_error'),
  query('page').optional().isInt({ min: 1 }).withMessage('error_messages.internal_error'),
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
