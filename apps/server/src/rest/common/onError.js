const pick = (table, key) =>
    (typeof key === 'string' && Object.hasOwn(table, key)) ? table[key] : undefined;

export const onError = (err, req, res, next) => {
    try {
        const errorHandler = pick(codeErrorHandlers, err?.code)
            || pick(errorHandlers, err?.constructor?.name);
        if (!errorHandler) console.error(`[onError] ${req?.method} ${req?.originalUrl}:`, err);
        (errorHandler || errorHandlers.InternalServerError)(res, err);
    } catch (error) {
        errorHandlers.InternalServerError(res);
    }
};

const codeErrorHandlers = {
    FEATURE_SELECTION_INVALID: (res) => {
      res.status(400).json({ error: 'error_messages.feature_selection_error' });
    },
    LINE_PLATFORM_NOT_FOUND: (res) => {
      res.status(404).json({ error: 'error_messages.line_platform_not_found' });
    },
    TEMPLATE_ERROR: (res, err) => {
      res.status(422).json({ error: 'error_messages.template_error', detail: err.message });
    },
    FEATURE_MODEL_EMPTY: (res) => {
      res.status(400).json({ error: 'error_messages.feature_model_empty' });
    },
    UVL_PARSE_ERROR: (res) => {
      res.status(400).json({ error: 'error_messages.uvl_validation_error' });
    },
    INVALID_PRODUCT_SPEC: (res) => {
      res.status(400).json({ error: 'error_messages.invalid_product_spec' });
    },
    INVALID_ARGUMENT: (res) => {
      res.status(400).json({ error: 'error_messages.invalid_argument' });
    },
    PRODUCTS_INDEX_ERROR: (res) => {
      res.status(500).json({ error: 'error_messages.products_index_error' });
    },
    MODULE_MANIFEST_INVALID: (res, err) => {
      res.status(422).json({ error: 'error_messages.module_manifest_invalid', detail: err.message });
    },
    MODULE_RESOLUTION_FAILED: (res, err) => {
      res.status(422).json({ error: 'error_messages.module_resolution_failed', detail: err.message });
    },
    MODULE_CHECK_FAILED: (res, err) => {
      res.status(422).json({ error: 'error_messages.module_check_failed', detail: err.message, diagnostics: err.diagnostics ?? [] });
    },
    GIT_HOST_NOT_LINKED: (res, err) => {
      res.status(403).json({ error: 'error_messages.git_host_not_linked', detail: err.message, host: err.host });
    },
    LOCKED: (res, err) => {
      res.status(409).json({ error: 'error_messages.product_locked', detail: err.message, kind: err.held?.kind ?? null, since: err.held?.since ?? null });
    },
    LAST_ADMIN: (res, err) => {
      res.status(409).json({ error: 'error_messages.last_admin', detail: err.message });
    },
    GIT_HOST_IS_OWN: (res, err) => {
      res.status(409).json({ error: 'error_messages.git_host_is_own', detail: err.message });
    },
    GIT_HOST_ACCOUNT_TAKEN: (res, err) => {
      res.status(409).json({ error: 'error_messages.git_host_account_taken', detail: err.message });
    },
    GIT_HOST_UNAVAILABLE: (res, err) => {
      res.status(503).json({ error: 'error_messages.git_host_unavailable', detail: err.message, host: err.host });
    },
    INSTANCE_SETTINGS: (res, err) => {
      res.status(err.status ?? 400).json({ error: 'error_messages.instance_settings', detail: err.message });
    },
    GIT_HOST_SETTINGS: (res, err) => {
      res.status(err.status ?? 400).json({ error: 'error_messages.git_host_settings', detail: err.message, ...(err.preview ? { preview: err.preview } : {}) });
    },
    MEMBERS_ON_HOST: (res, err) => {
      res.status(409).json({ error: 'error_messages.members_on_host', detail: err.message });
    },
    ACCESS_LEVEL: (res, err) => {
      res.status(400).json({ error: 'error_messages.access_level', detail: err.message });
    },
    TOO_MANY_ATTEMPTS: (res, err) => {
      res.status(429).json({ error: 'error_messages.too_many_attempts', detail: err.message });
    },
    INVALID_USERNAME: (res, err) => {
      res.status(400).json({ error: 'error_messages.username_validation', detail: err.message });
    },
    WEAK_PASSWORD: (res, err) => {
      res.status(400).json({ error: 'error_messages.weak_password', detail: err.message });
    },
    // what the git host refused when asked for code (a branch that exists, a file that moved on): its status, and what it said
    REPOSITORY_REFUSED: (res, err) => {
      res.status(err.status ?? 400).json({ error: 'error_messages.repository_refused', detail: err.message });
    },
    ISSUE_REFUSED: (res, err) => {
      res.status(err.status ?? 400).json({ error: 'error_messages.issue_refused', detail: err.message });
    },
    PLUGIN_NOT_FOUND: (res, err) => {
      res.status(404).json({ error: 'error_messages.plugin_not_found', detail: err.message });
    },
    PLUGIN_DISABLED: (res, err) => {
      res.status(404).json({ error: 'error_messages.plugin_disabled', detail: err.message, plugin: err.pluginId });
    },
    PLUGIN_INCOMPATIBLE: (res, err) => {
      res.status(409).json({ error: 'error_messages.plugin_incompatible', detail: err.message });
    },
    PLUGIN_STATE: (res, err) => {
      res.status(409).json({ error: 'error_messages.plugin_state', detail: err.message });
    },
    ANALYSIS_RUNTIME_ERROR: (res) => {
      res.status(500).json({ error: 'error_messages.analysis_runtime_error' });
    },
  };

const errorHandlers = {
    // body-parser's refusal of a body over the limit (an enormous model, say): it is the caller's, not a server failure
    PayloadTooLargeError: (res) => {
      res.status(413).json({ error: 'error_messages.payload_too_large' });
    },
    GitLabError: (res) => {
      res.status(400).json({ error: 'error_messages.gitlab_error' });
    },
    GitLabAuthError: (res) => {
      res.status(401).json({ error: 'error_messages.incorrect_credentials', code: 'GIT_HOST_AUTH' });
    },
    // the same two, as raised by a git host that is not GitLab (the code stays GIT_HOST_AUTH: it is what the client already refreshes on)
    GitError: (res) => {
      res.status(400).json({ error: 'error_messages.gitlab_error' });
    },
    GitAuthError: (res) => {
      res.status(401).json({ error: 'error_messages.incorrect_credentials', code: 'GIT_HOST_AUTH' });
    },
    IncorrectCredentialsError: (res) => {
      res.status(401).json({ error: 'error_messages.incorrect_credentials' });
    },
    UserNotFoundError: (res) => {
      res.status(404).json({ error: 'error_messages.user_not_found' });
    },
    LineNotFoundError: (res) => {
      res.status(404).json({ error: 'error_messages.line_not_found' });
    },
    RepositoryAccessError: (res, err) => {
      res.status(502).json({ error: 'error_messages.repository_access_failed', detail: err.message });
    },
    ProductNotFoundError: (res) => {
      res.status(404).json({ error: 'error_messages.product_not_found' });
    },
    LinePlatformNotFoundError: (res) => {
      res.status(404).json({ error: 'error_messages.line_platform_not_found' });
    },
    PermissionError: (res) => {
      res.status(403).json({ error: 'error_messages.permission_error' });
    },
    AlreadyExistentUserError: (res) => {
      res.status(409).json({ error: 'error_messages.already_existent_user' });
    },
    AlreadyExistentLineError: (res) => {
      res.status(409).json({ error: 'error_messages.already_existent_line' });
    },
    AlreadyExistentProductError: (res) => {
      res.status(409).json({ error: 'error_messages.already_existent_product' });
    },
    FeatureSelectionError: (res) => {
      res.status(400).json({ error: 'error_messages.feature_selection_error' });
    },
    ProductSpecUnavailableError: (res) => {
      res.status(503).json({ error: 'error_messages.product_spec_unavailable' });
    },
    ProductSpecFileError: (res) => {
      res.status(422).json({ error: 'error_messages.product_spec_invalid' });
    },
    PackageNotFoundError: (res) => {
      res.status(404).json({ error: 'error_messages.package_not_found' });
    },
    PackageNotAllowedError: (res, err) => {
      res.status(403).json({ error: 'error_messages.package_not_allowed', detail: err.message });
    },
    PackageVersionExistsError: (res, err) => {
      res.status(409).json({ error: 'error_messages.package_version_exists', detail: err.message });
    },
    RegistryNotConfiguredError: (res) => {
      res.status(409).json({ error: 'error_messages.registry_not_configured' });
    },
    LineNotModularError: (res) => {
      res.status(409).json({ error: 'error_messages.line_not_modular' });
    },
    RestoreBlockedError: (res) => {
      res.status(409).json({ error: 'error_messages.restore_blocked' });
    },
    LineDeletedError: (res) => {
      res.status(409).json({ error: 'error_messages.line_deleted' });
    },
    LineModularReadOnlyError: (res) => {
      res.status(409).json({ error: 'error_messages.line_modular_read_only' });
    },
    CiConfigError: (res, err) => {
      res.status(400).json({ error: 'error_messages.ci_config_invalid', detail: err.message });
    },
    NoPipelineError: (res) => {
      res.status(409).json({ error: 'error_messages.no_pipeline' });
    },
    NoPendingUpdateError: (res) => {
      res.status(409).json({ error: 'error_messages.no_pending_update' });
    },
    NoDeployedSnapshotError: (res) => {
      res.status(409).json({ error: 'error_messages.no_deployed_snapshot' });
    },
    InternalServerError: (res) => {
      res.status(500).json({ error: 'error_messages.internal_error' });
    },
  };