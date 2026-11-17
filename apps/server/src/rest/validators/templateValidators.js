import { body, param } from 'express-validator';
import handleValidationErrors from './commonValidationHandler.js';

export const templateNameValidator = [
  param('name').isString().trim().notEmpty().isLength({ max: 100 }).withMessage('error_messages.internal_error'),
  handleValidationErrors
];

export const templateValidator = [
  ...templateNameValidator.slice(0, -1),
  body('content').isString().isLength({ max: 100000 }).withMessage('error_messages.internal_error'),
  handleValidationErrors
];
