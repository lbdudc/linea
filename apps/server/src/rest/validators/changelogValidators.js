import { query } from 'express-validator';
import handleValidationErrors from './commonValidationHandler.js';
import { VERSION_PATTERN } from './commonValidators.js';

/** The versions that bound a changelog's range, all optional. */
export const changelogRangeValidator = [
  ...['from', 'to', 'lineFrom', 'lineTo'].map((name) => query(name).optional({ values: 'falsy' }).isString().matches(VERSION_PATTERN).withMessage('error_messages.basicData_version_format')),
  handleValidationErrors,
];
