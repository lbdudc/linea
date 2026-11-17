import { check, param, query } from 'express-validator'
import { KINDS } from '@lbdudc/linea-git'
import handleValidationErrors from './commonValidationHandler.js'
import { nameRule } from './commonValidators.js'

const handle = handleValidationErrors

const kindRule = param('kind').isIn(KINDS).withMessage('error_messages.internal_error')
const idRule = param('id').isInt({ min: 1 }).withMessage('error_messages.internal_error')
const bumpRule = check('bump').optional({ nullable: true }).isIn(['patch', 'minor', 'major']).withMessage('error_messages.internal_error')

export const listPackagesValidator = () => [kindRule, handle]

export const createPackageValidator = () => [
  kindRule,
  nameRule('name', 'error_messages.name_validation'),
  check('description').optional().isString().withMessage('error_messages.description_validation'),
  check('register').optional().isBoolean().withMessage('error_messages.internal_error'),
  check('namespaceId').optional({ nullable: true }).isInt({ min: 1 }).toInt().withMessage('error_messages.internal_error'),
  handle,
]

export const packageValidator = () => [kindRule, idRule, handle]

const safePath = (value) => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/^\/|\\|\0/.test(value) && !value.split('/').includes('..')

const trialRules = () => [
  kindRule,
  idRule,
  check('ref').optional().isString().isLength({ min: 1, max: 255 }).not().matches(/^-|\0/).withMessage('error_messages.internal_error'),
  check('changes').optional().isArray({ max: 500 }).withMessage('error_messages.internal_error'),
  check('changes.*.path').custom(safePath).withMessage('error_messages.internal_error'),
  check('changes.*.action').isIn(['create', 'update', 'delete']).withMessage('error_messages.internal_error'),
  check('changes.*.content').optional({ nullable: true }).isString().withMessage('error_messages.internal_error'),
  check('alongside').optional().isArray({ max: 20 }).withMessage('error_messages.internal_error'),
  check('alongside.*').isString().isLength({ min: 1, max: 512 }).withMessage('error_messages.internal_error'),
  check('others').optional().isArray({ max: 50 }).withMessage('error_messages.internal_error'),
  check('others.*.location').isString().isLength({ min: 1, max: 512 }).withMessage('error_messages.internal_error'),
  check('others.*.changes').isArray({ max: 500 }).withMessage('error_messages.internal_error'),
  check('others.*.changes.*.path').custom(safePath).withMessage('error_messages.internal_error'),
  check('others.*.changes.*.action').isIn(['create', 'update', 'delete']).withMessage('error_messages.internal_error'),
  check('others.*.changes.*.content').optional({ nullable: true }).isString().withMessage('error_messages.internal_error'),
]

export const packageTrialValidator = () => [...trialRules(), handle]

const modelRules = () => [
  check('models').optional().isObject().withMessage('error_messages.internal_error')
    .custom((models) => Object.values(models).every((text) => typeof text === 'string')).withMessage('error_messages.internal_error'),
  check('features').optional().isArray({ max: 5000 }).withMessage('error_messages.internal_error'),
  check('features.*').isString().isLength({ min: 1, max: 255 }).withMessage('error_messages.internal_error'),
]

export const packageCheckTrialValidator = () => [...trialRules(), ...modelRules(), handle]

export const packageDeriveTrialValidator = () => [
  ...trialRules(),
  check('models').optional().isObject().withMessage('error_messages.internal_error')
    .custom((models) => Object.values(models).every((text) => typeof text === 'string')).withMessage('error_messages.internal_error'),
  check('features').optional().isArray({ max: 5000 }).withMessage('error_messages.internal_error'),
  check('features.*').isString().isLength({ min: 1, max: 255 }).withMessage('error_messages.internal_error'),
  check('spec').optional({ nullable: true }).isObject().withMessage('error_messages.internal_error'),
  check('include').optional().isArray({ max: 20 }).withMessage('error_messages.internal_error'),
  check('include.*').custom(safePath).withMessage('error_messages.internal_error'),
  check('contents').optional().isBoolean().withMessage('error_messages.internal_error'),
  check('zip').optional().isBoolean().withMessage('error_messages.internal_error'),
  handle,
]

export const readPackageFileValidator = () => [
  kindRule,
  idRule,
  query('path').isString().notEmpty().withMessage('error_messages.content_validation'),
  query('ref').optional().isString().withMessage('error_messages.internal_error'),
  handle,
]

export const savePackageFileValidator = () => [
  kindRule,
  idRule,
  check('path').isString().notEmpty().withMessage('error_messages.content_validation'),
  check('content').isString().withMessage('error_messages.content_validation'),
  check('message').optional().isString().withMessage('error_messages.internal_error'),
  handle,
]

const filesRule = check('files')
  .isObject()
  .withMessage('error_messages.content_validation')
  .custom((files) => Object.keys(files).length > 0 && Object.values(files).every((content) => content === null || typeof content === 'string'))
  .withMessage('error_messages.content_validation')

export const savePackageFilesValidator = () => [
  kindRule,
  idRule,
  filesRule,
  check('message').optional().isString().withMessage('error_messages.internal_error'),
  handle,
]

export const deletePackageFileValidator = () => [
  kindRule,
  idRule,
  query('path').isString().notEmpty().withMessage('error_messages.content_validation'),
  handle,
]

export const publishPackageValidator = () => [kindRule, idRule, bumpRule, handle]

const rangesRule = (field) => check(field)
  .optional()
  .isObject()
  .withMessage('error_messages.internal_error')
  .custom((ranges) => Object.values(ranges).every((range) => typeof range === 'string'))
  .withMessage('error_messages.internal_error')

// the modules of a modular line, the metamodels of a project, or both: at least one
const somethingToPin = check('modules').custom((_, { req }) => req.body?.modules !== undefined || req.body?.metamodels !== undefined).withMessage('error_messages.internal_error')

export const saveLineModulesValidator = () => [rangesRule('modules'), rangesRule('metamodels'), somethingToPin, bumpRule, handle]
export const checkLineModulesValidator = () => [rangesRule('modules'), rangesRule('metamodels'), handle]

const locationRule = (source) => source('location').isString().matches(/^[a-z]+:\S+$/).withMessage('error_messages.internal_error')
const kindQuery = query('kind').optional().isIn(KINDS).withMessage('error_messages.internal_error')

export const listRegistryValidator = () => [kindQuery, handle]
export const registerPackageValidator = () => [locationRule(check), handle]
export const unregisterPackageValidator = () => [locationRule(query), handle]
