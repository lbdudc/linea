import { check } from 'express-validator';

// Shared field patterns reused across product/line validators.
export const NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

// A non-empty string field constrained to NAME_PATTERN. `emptyMsg` is the
// message for the notEmpty check (it differs per field).
export const nameRule = (field, emptyMsg) =>
  check(field).isString().notEmpty().withMessage(emptyMsg)
    .matches(NAME_PATTERN).withMessage('error_messages.invalid_name_characters');

// A semver-ish version field. `msg` differs per caller.
export const versionRule = (field, msg) =>
  check(field).matches(VERSION_PATTERN).withMessage(msg);
