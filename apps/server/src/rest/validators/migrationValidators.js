import { check } from 'express-validator';
import handleValidationErrors from './commonValidationHandler.js';

export const impactValidator = [
    // the feature model of a line with its own file, or the modules of a line made of them
    check('content').if((value, { req }) => !req.body?.modules && !req.body?.metamodels).isString().notEmpty().withMessage('error_messages.content_validation'),
    check('modules').optional().isObject().withMessage('error_messages.internal_error')
      .custom((modules) => Object.values(modules).every((range) => typeof range === 'string'))
      .withMessage('error_messages.internal_error'),
    check('metamodels').optional().isObject().withMessage('error_messages.internal_error')
      .custom((metamodels) => Object.values(metamodels).every((range) => typeof range === 'string'))
      .withMessage('error_messages.internal_error'),
    handleValidationErrors
];
