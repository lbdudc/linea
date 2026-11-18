import { body, param } from 'express-validator';
import handleValidationErrors from './commonValidationHandler.js';

const username = param('username').isString().notEmpty().withMessage('error_messages.username_validation');

// reporter 20, developer 30, maintainer 40, owner 50 (the host says which of them it can give)
export const accessValidator = [
  username,
  body('role').isIn([20, 30, 40, 50]).withMessage('error_messages.access_level'),
  handleValidationErrors
];

// a product may also close itself to a person: level 0
export const productAccessValidator = [
  username,
  body('role').isIn([0, 20, 30, 40, 50]).withMessage('error_messages.access_level'),
  handleValidationErrors
];

export const accessParamValidator = [username, handleValidationErrors];
