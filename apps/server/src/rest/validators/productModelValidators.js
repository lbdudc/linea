import { check, param } from 'express-validator';
import handleValidationErrors from './commonValidationHandler.js';

/** The positions of the nodes of diagrams are a few numbers each: a large body is not that. */
const MAX_LAYOUTS_CHARS = 256 * 1024;
const small = (value) => JSON.stringify(value ?? {}).length <= MAX_LAYOUTS_CHARS;

export const saveProductModelValidator = [
  param('metamodel').matches(/^[a-zA-Z0-9_\-.]+$/).withMessage('error_messages.internal_error'),
  check('content').isString().withMessage('error_messages.content_validation'),
  check('layouts').optional().isObject().custom(small).withMessage('error_messages.internal_error'),
  handleValidationErrors,
];

export const saveProductSelectionValidator = [
  check('features').isArray({ max: 5000 }).withMessage('error_messages.internal_error'),
  check('features.*').isString().matches(/^[A-Za-z_][A-Za-z0-9_]*$/).withMessage('error_messages.internal_error'),
  handleValidationErrors,
];

export const saveProductLayoutsValidator = [
  check('layouts').isObject().custom(small).withMessage('error_messages.internal_error'),
  handleValidationErrors,
];

export const checkProductModelsValidator = [
  check('models').optional().isObject().withMessage('error_messages.internal_error'),
  handleValidationErrors,
];
