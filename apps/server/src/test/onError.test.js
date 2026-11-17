import { describe, expect, it, vi } from 'vitest';
import { GitLabAuthError, GitLabError } from 'gitlab-commando';
import { onError } from '../rest/common/onError.js';
import { PermissionError } from '../model/errors/errors.js';
import { ProductSpecUnavailableError } from '../model/services/ProductSpecService.js';
import FeatureSelectionError from 'spl-js-engine/src/feature-model/feature-selection-error.js';
import {
  LineaCoreError,
  InvalidArgumentError,
  UvlParseError,
  FeatureSelectionInvalidError,
  LinePlatformNotFoundError,
  InvalidProductSpecError,
  ProductsIndexError,
  AnalysisRuntimeError,
} from '@lbdudc/linea-core';

const fakeRes = () => {
  const res = {
    statusCode: undefined,
    body: undefined,
    status (code) { res.statusCode = code; return res; },
    json (payload) { res.body = payload; return res; }
  };
  return res;
};

describe('onError: contrato HTTP', () => {
  it('convierte GitLabAuthError en 401 con code GIT_HOST_AUTH', () => {
    const res = fakeRes();
    onError(new GitLabAuthError('token caducado'), {}, res, vi.fn());

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('GIT_HOST_AUTH');
    expect(res.body.error).toBe('error_messages.incorrect_credentials');
  });

  it('no confunde GitLabAuthError con PermissionError', () => {
    const res = fakeRes();
    onError(new PermissionError(), {}, res, vi.fn());

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBeUndefined();
  });

  it('distingue GitLabError de GitLabAuthError', () => {
    const res = fakeRes();
    onError(new GitLabError('fallo generico'), {}, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('error_messages.gitlab_error');
  });

  it('cae a 500 con un error desconocido, sin lanzar', () => {
    const res = fakeRes();
    onError(new Error('vaya'), {}, res, vi.fn());

    expect(res.statusCode).toBe(500);
  });

  it('cae a 500 cuando el error no tiene constructor utilizable', () => {
    const res = fakeRes();
    expect(() => onError(null, {}, res, vi.fn())).not.toThrow();
    expect(res.statusCode).toBe(500);
  });

  it('convierte ProductSpecUnavailableError en 503 con la clave i18n nueva', () => {
    const res = fakeRes();
    onError(new ProductSpecUnavailableError('no se pudo leer el spec'), {}, res, vi.fn());

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('error_messages.product_spec_unavailable');
  });
});

describe('onError: dispatch por código de @lbdudc/linea-core (ADR-018)', () => {
  const cases = [
    ['InvalidArgumentError', InvalidArgumentError, 400, 'error_messages.invalid_argument'],
    ['UvlParseError', UvlParseError, 400, 'error_messages.uvl_validation_error'],
    ['FeatureSelectionInvalidError', FeatureSelectionInvalidError, 400, 'error_messages.feature_selection_error'],
    ['LinePlatformNotFoundError', LinePlatformNotFoundError, 404, 'error_messages.line_platform_not_found'],
    ['InvalidProductSpecError', InvalidProductSpecError, 400, 'error_messages.invalid_product_spec'],
    ['ProductsIndexError', ProductsIndexError, 500, 'error_messages.products_index_error'],
    ['AnalysisRuntimeError', AnalysisRuntimeError, 500, 'error_messages.analysis_runtime_error'],
  ];

  for (const [name, ErrorClass, expectedStatus, expectedMessage] of cases) {
    it(`${name} (code ${new ErrorClass('boom').code}) -> ${expectedStatus} ${expectedMessage}`, () => {
      const res = fakeRes();
      onError(new ErrorClass('boom'), {}, res, vi.fn());

      expect(res.statusCode).toBe(expectedStatus);
      expect(res.body.error).toBe(expectedMessage);
    });
  }

  it('despacha por .code incluso sobre la clase base LineaCoreError, no por nombre', () => {
    const res = fakeRes();
    onError(new LineaCoreError('FEATURE_SELECTION_INVALID', 'boom'), {}, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('error_messages.feature_selection_error');
  });

  it('dice que el modelo de características está vacío, no que falta la plataforma', () => {
    const res = fakeRes();
    onError(new LineaCoreError('FEATURE_MODEL_EMPTY', 'boom'), {}, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('error_messages.feature_model_empty');
  });

  it('un code heredado de Object.prototype no se confunde con un handler', () => {
    for (const code of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const res = fakeRes();
      const err = new Error('boom');
      err.code = code;

      expect(() => onError(err, {}, res, vi.fn()), code).not.toThrow();
      expect(res.statusCode, `code=${code} debe caer a 500`).toBe(500);
    }
  });

  it('un code de Node como ENOENT cae al comportamiento histórico', () => {
    const res = fakeRes();
    const err = new Error('no such file');
    err.code = 'ENOENT';
    onError(err, {}, res, vi.fn());

    expect(res.statusCode).toBe(500);
  });

  it('el despacho por código no secuestra el FeatureSelectionError del monolito (spl-js-engine)', () => {
    const res = fakeRes();
    onError(new FeatureSelectionError('boom'), {}, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('error_messages.feature_selection_error');
    expect(res.body.code).toBeUndefined();
  });
});

it('a body over the size limit is answered 413, not as a server failure', () => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  class PayloadTooLargeError extends Error {}
  onError(new PayloadTooLargeError('request entity too large'), {}, res);
  expect(res.status).toHaveBeenCalledWith(413);
  expect(res.json).toHaveBeenCalledWith({ error: 'error_messages.payload_too_large' });
});
