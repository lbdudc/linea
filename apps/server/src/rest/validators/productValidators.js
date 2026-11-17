import { check, param } from 'express-validator';
import handleValidationErrors from './commonValidationHandler.js';
import { nameRule, versionRule, VERSION_PATTERN } from './commonValidators.js';
import { cronProblem } from '../../model/services/scheduler/cron.js';

export const createProductValidator = [
    check('lineId').isString().notEmpty().withMessage('error_messages.lineId_validation'),
    check('spec').isObject().withMessage('error_messages.spec_object_validation'),
    check('spec.basicData').isObject().withMessage('error_messages.basicData_object_validation'),
    nameRule('spec.basicData.name', 'error_messages.basicData_name_validation'),
    versionRule('spec.basicData.version', 'error_messages.basicData_version_format'),
    handleValidationErrors
];

// What a spec keeps besides its basic data: anything of another shape used to be stored as an empty value without a word.
const specContentRules = [
    check('spec.features').optional().isArray().withMessage('error_messages.spec_object_validation'),
    check('spec.features.*').optional().isString().withMessage('error_messages.spec_object_validation'),
    check('spec.statics').optional().isArray().withMessage('error_messages.spec_object_validation'),
    check('spec.dataModel').optional().isObject().withMessage('error_messages.spec_object_validation'),
];

export const updateProductValidator = [
    check('spec').isObject().withMessage('error_messages.spec_object_validation'),
    check('spec.basicData').isObject().withMessage('error_messages.basicData_object_validation'),
    nameRule('spec.basicData.name', 'error_messages.basicData_name_validation'),
    versionRule('spec.basicData.version', 'error_messages.basicData_version_format'),
    ...specContentRules,
    check('importedSpec').optional({ nullable: true }).isObject().custom((value) => JSON.stringify(value).length <= 16 * 1024 * 1024).withMessage('error_messages.spec_object_validation'),
    handleValidationErrors
];

export const renameProductValidator = [
    nameRule('name', 'error_messages.name_validation'),
    handleValidationErrors
];

// Which part of the version a generation raises; omitted means patch.
export const generateProductValidator = [
    check('bump').optional().isIn(['major', 'minor', 'patch']).withMessage('error_messages.bump_validation'),
    handleValidationErrors
];

// What to put back when discarding: 'features', 'fields' or 'model:<name>'; omitted means everything.
export const discardSavedValidator = [
    check('parts').optional().isArray({ max: 64 }).withMessage('error_messages.discard_parts_validation'),
    check('parts.*').optional().isString().matches(/^(features|fields|model:[\w.-]{1,80})$/).withMessage('error_messages.discard_parts_validation'),
    handleValidationErrors
];

// `spec` is optional: without it the zip is made from the saved one
export const generateZipValidator = [
    check('spec').optional().isObject().withMessage('error_messages.spec_object_validation'),
    check('spec.basicData').if(check('spec').exists()).isObject().withMessage('error_messages.basicData_object_validation'),
    check('spec.basicData.name').if(check('spec').exists()).isString().notEmpty().withMessage('error_messages.basicData_name_validation'),
    check('spec.basicData.version').if(check('spec').exists()).matches(VERSION_PATTERN).withMessage('error_messages.basicData_version_format'),
    check('lineRef').optional().isString().isLength({ max: 255 }).withMessage('error_messages.internal_error'),
    check('overrides').optional().isArray({ max: 500 }).withMessage('error_messages.internal_error'),
    check('overrides.*.path').isString().notEmpty().isLength({ max: 1024 }).not().matches(/^\/|(^|\/)\.\.(\/|$)|\0/).withMessage('error_messages.internal_error'),
    check('overrides.*.action').isIn(['create', 'update', 'delete']).withMessage('error_messages.internal_error'),
    check('overrides.*.content').optional().isString().withMessage('error_messages.internal_error'),
    handleValidationErrors
];

export const productVersionValidator = [
    param('version').matches(VERSION_PATTERN).withMessage('error_messages.basicData_version_format'),
    handleValidationErrors
];

export const productCiRunnersValidator = [
    check('instanceRunners').isBoolean().withMessage('error_messages.ci_runners_validation'),
    handleValidationErrors
];

export const productMergeRequestValidator = [
    param('number').isInt({ min: 1 }).withMessage('error_messages.merge_request_number_validation'),
    handleValidationErrors
];

export const productUpdateDecisionValidator = [
    param('number').isInt({ min: 1 }).withMessage('error_messages.merge_request_number_validation'),
    check('decision').isIn(['merge', 'reject']).withMessage('error_messages.invalid_argument'),
    handleValidationErrors
];

export const productJobValidator = [
    param('jobId').isInt({ min: 1 }).withMessage('error_messages.job_id_validation'),
    handleValidationErrors
];

// How a product syncs and generates: `sync` and `generation` are partial, only what is sent changes.
const PRESETS = ['1h', '3h', '6h', '12h', '24h', 'weekly', 'cron'];
const BEHAVIORS = ['check', 'mr', 'merge'];
const cronRule = (prefix) => check(`${prefix}.cron`).if((value, { req }) => (prefix.split('.').reduce((o, k) => o?.[k], req.body))?.preset === 'cron')
    .custom((value) => !cronProblem(value)).withMessage('error_messages.cron_validation');

export const productAutomationValidator = [
    check('sync').optional().isObject().withMessage('error_messages.invalid_argument'),
    check('sync.mode').optional().isIn(['inherit', 'custom', 'off']).withMessage('error_messages.invalid_argument'),
    check('sync.preset').optional().isIn(PRESETS).withMessage('error_messages.invalid_argument'),
    check('sync.behavior').optional().isIn(['inherit', ...BEHAVIORS]).withMessage('error_messages.invalid_argument'),
    cronRule('sync'),
    check('generation').optional().isObject().withMessage('error_messages.invalid_argument'),
    check('generation.bump').optional().isIn(['major', 'minor', 'patch']).withMessage('error_messages.bump_validation'),
    check('generation.autoMerge').optional().isBoolean().withMessage('error_messages.invalid_argument'),
    handleValidationErrors
];

export const lineSyncValidator = [
    check('sync').isObject().withMessage('error_messages.invalid_argument'),
    check('sync.enabled').optional().isBoolean().withMessage('error_messages.invalid_argument'),
    check('sync.preset').optional().isIn(PRESETS).withMessage('error_messages.invalid_argument'),
    check('sync.behavior').optional().isIn(BEHAVIORS).withMessage('error_messages.invalid_argument'),
    cronRule('sync'),
    handleValidationErrors
];
