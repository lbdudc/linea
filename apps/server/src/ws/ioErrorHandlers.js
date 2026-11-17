import { Container } from "typedi";
import ProductService from "../model/services/ProductService.js";
import { incrementVersion } from "@lbdudc/linea-core";
import LogService from "../model/services/LogService.js";

const ioCodeErrorHandlers = {
    FEATURE_SELECTION_INVALID: (req) => {
        emitError(req, 'error_messages.feature_selection_error')
    },
    LINE_PLATFORM_NOT_FOUND: (req) => {
        emitError(req, 'error_messages.line_platform_not_found')
    },
    TEMPLATE_ERROR: (req, error) => {
        emitError(req, 'error_messages.template_error', error?.message)
    },
    FEATURE_MODEL_EMPTY: (req) => {
        emitError(req, 'error_messages.feature_model_empty')
    },
    UVL_PARSE_ERROR: (req) => {
        emitError(req, 'error_messages.uvl_validation_error')
    },
    INVALID_PRODUCT_SPEC: (req) => {
        emitError(req, 'error_messages.invalid_product_spec')
    },
    INVALID_ARGUMENT: (req) => {
        emitError(req, 'error_messages.invalid_argument')
    },
    PRODUCTS_INDEX_ERROR: (req) => {
        emitError(req, 'error_messages.products_index_error')
    },
    ANALYSIS_RUNTIME_ERROR: (req) => {
        emitError(req, 'error_messages.analysis_runtime_error')
    },
    MODULE_MANIFEST_INVALID: (req) => {
        emitError(req, 'error_messages.module_manifest_invalid')
    },
    MODULE_RESOLUTION_FAILED: (req) => {
        emitError(req, 'error_messages.module_resolution_failed')
    },
    MODULE_CHECK_FAILED: (req) => {
        emitError(req, 'error_messages.module_check_failed')
    },
};

const ioErrorHandlers = {
    GitLabError: (req) => {
        emitError(req, 'error_messages.gitlab_error')
    },
    GitLabAuthError: (req) => {
        emitError(req, 'error_messages.incorrect_credentials')
    },
    GitError: (req) => {
        emitError(req, 'error_messages.gitlab_error')
    },
    GitAuthError: (req) => {
        emitError(req, 'error_messages.incorrect_credentials')
    },
    IncorrectCredentialsError: (req) => {
        emitError(req, 'error_messages.incorrect_credentials')
    },
    UserNotFoundError: (req) => {
        emitError(req, 'error_messages.user_not_found')
    },
    LinePlatformNotFoundError: (req) => {
        emitError(req, 'error_messages.line_platform_not_found')
    },
    PermissionError: (req) => {
        emitError(req, 'error_messages.permission_error')
    },
    LineDeletedError: (req) => {
        emitError(req, 'error_messages.line_deleted')
    },
    AlreadyExistentUserError: (req) => {
        emitError(req, 'error_messages.already_existent_user')
    },
    AlreadyExistentLineError: (req) => {
        emitError(req, 'error_messages.already_existent_line')
    },
    AlreadyExistentProductError: (req) => {
        emitError(req, 'error_messages.already_existent_product')
    },
    FeatureSelectionError: (req) => {
        emitError(req, 'error_messages.feature_selection_error' );
    },
    ProductSpecUnavailableError: (req) => {
        emitError(req, 'error_messages.product_spec_unavailable')
    },
    ProductSpecFileError: (req) => {
        emitError(req, 'error_messages.product_spec_invalid')
    },
    InternalServerError: (req) => {
        emitError(req, 'error_messages.internal_error')
    },
  };
  
const pick = (table, key) =>
    (typeof key === 'string' && Object.hasOwn(table, key)) ? table[key] : undefined;

export const dispatchIoError = (error, req) => {
    const ioErrorHandler = pick(ioCodeErrorHandlers, error?.code)
        || pick(ioErrorHandlers, error?.constructor?.name)
        || ioErrorHandlers.InternalServerError;
    ioErrorHandler(req, error);
};

// the product the failure belongs to: the route names it `id` (products) or `productId` (nested routes)
const productIdOf = (req) => req.params?.id ?? req.params?.productId;

const emitError = async (req, message, detail) => {
    try {
        const productId = productIdOf(req);
        if (!productId) throw new Error(`no product id in the route params of ${req?.method} ${req?.originalUrl}`);
        const productService = Container.get(ProductService);
        const logService = Container.get(LogService);
        const product = await productService.findProductById({ id: productId, userId: req.userId });
        const version = incrementVersion({ version: product.spec.basicData.version, index: 2 });

        req.app.get('io').to(req.userId).emit('generation', { version: product.spec.basicData.version, type: 'error', message, ...(detail ? { detail } : {}), createdAt: new Date() });
        await logService.createLog({ version, type: 'error', message, params: detail ? [detail] : undefined, createdAt: new Date(), userId: req.userId, productId });
    } catch (err) {
        console.error('[emitError] Failed to emit generation error:', err);
    }
}

export default ioErrorHandlers;