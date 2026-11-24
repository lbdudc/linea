import { check, body, param } from 'express-validator';
import { enabledHosts } from '../../model/git/index.js';
import { isValidUsername } from '../../model/git/localAccounts.js';
import handleValidationErrors from './commonValidationHandler.js';

// the host of a route (`/login/:host`) is one of those that are on
export const hostParam = param('host').custom((value) => enabledHosts().includes(value)).withMessage('error_messages.git_host_validation');

export const localLoginValidator = [
    body('username').isString().trim().notEmpty().withMessage('error_messages.incorrect_credentials'),
    body('password').isString().notEmpty().withMessage('error_messages.incorrect_credentials'),
    handleValidationErrors
];

export const createLocalUserValidator = [
    body('username').isString().trim().custom(isValidUsername).withMessage('error_messages.username_validation'),
    body('password').isString().withMessage('error_messages.weak_password'),
    body('admin').optional().isBoolean().withMessage('error_messages.internal_error'),
    handleValidationErrors
];

export const setDisabledValidator = [
    param('id').isMongoId().withMessage('error_messages.internal_error'),
    body('disabled').isBoolean().withMessage('error_messages.internal_error'),
    handleValidationErrors
];

export const deleteUserValidator = [
    param('id').isMongoId().withMessage('error_messages.internal_error'),
    check('transferTo').optional().isString().withMessage('error_messages.username_validation'),
    handleValidationErrors
];

export const changeOwnPasswordValidator = [
    body('currentPassword').isString().notEmpty().withMessage('error_messages.incorrect_credentials'),
    body('newPassword').isString().withMessage('error_messages.weak_password'),
    handleValidationErrors
];

export const setPasswordValidator = [
    body('password').isString().withMessage('error_messages.weak_password'),
    handleValidationErrors
];

export const loginFromGitLabValidator = [
    check('code').isString().notEmpty().withMessage('error_messages.code_validation'),
    handleValidationErrors
];

export const NATIVE_LOGIN_CALLBACK_PATH = '/callback';

export function isAllowedNativeRedirectUri(value) {
    if (typeof value !== 'string') {
        return false;
    }

    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }

    if (url.href !== value) {
        return false;
    }

    if (url.protocol !== 'http:') {
        return false;
    }

    if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') {
        return false;
    }

    if (url.pathname !== NATIVE_LOGIN_CALLBACK_PATH) {
        return false;
    }

    if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
        return false;
    }

    return true;
}

export const loginFromGitLabNativeValidator = [
    body('host').optional().custom((value) => enabledHosts().includes(value)).withMessage('error_messages.git_host_validation'),
    body('code').isString().withMessage('error_messages.code_validation')
        .notEmpty().withMessage('error_messages.code_validation'),
    body('redirect_uri').isString().withMessage('error_messages.redirect_uri_validation')
        .notEmpty().withMessage('error_messages.redirect_uri_validation')
        .custom(isAllowedNativeRedirectUri).withMessage('error_messages.redirect_uri_validation'),
    handleValidationErrors
];


export const tokenLoginValidator = [
    body('token').isString().withMessage('error_messages.incorrect_credentials')
        .trim().notEmpty().withMessage('error_messages.incorrect_credentials')
        .isLength({ max: 512 }).withMessage('error_messages.incorrect_credentials'),
    handleValidationErrors
];

export const deviceCodeValidator = [
    body('device_code').isString().withMessage('error_messages.code_validation')
        .notEmpty().withMessage('error_messages.code_validation')
        .isLength({ max: 512 }).withMessage('error_messages.code_validation'),
    body('interval').optional().isInt({ min: 1, max: 60 }).withMessage('error_messages.code_validation'),
    handleValidationErrors
];

// a native link has no `host` in the body (it is in the path)
export const linkNativeValidator = [
    body('code').isString().withMessage('error_messages.code_validation').notEmpty().withMessage('error_messages.code_validation'),
    body('redirect_uri').isString().withMessage('error_messages.redirect_uri_validation')
        .custom(isAllowedNativeRedirectUri).withMessage('error_messages.redirect_uri_validation'),
    handleValidationErrors
];

// the profile is one of the hosts that are on
export const profileValidator = [
    body('host').isString().custom((value) => enabledHosts().includes(value)).withMessage('error_messages.git_host_validation'),
    handleValidationErrors
];

export const setAdminValidator = [
    body('admin').isBoolean().withMessage('error_messages.internal_error'),
    handleValidationErrors
];
