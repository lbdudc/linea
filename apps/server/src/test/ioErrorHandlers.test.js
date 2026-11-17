import { describe, expect, it, vi } from 'vitest';
import { Container } from 'typedi';
import ProductService from '../model/services/ProductService.js';
import LogService from '../model/services/LogService.js';
import { dispatchIoError } from '../ws/ioErrorHandlers.js';
import { FeatureSelectionInvalidError, LinePlatformNotFoundError, TemplateError } from '@lbdudc/linea-core';
import { PermissionError } from '../model/errors/errors.js';
import { ProductSpecUnavailableError } from '../model/services/ProductSpecService.js';

const fakeReq = () => {
  const emit = vi.fn();
  const req = {
    params: { id: 'product-1' },
    userId: 'user-1',
    app: { get: () => ({ to: () => ({ emit }) }) },
  };
  return { req, emit };
};

const productService = Container.get(ProductService);
const logService = Container.get(LogService);

describe('dispatchIoError: mismo orden código-antes-que-nombre que onError', () => {
  it('despacha por .code (linea-core) cuando el error lo trae', async () => {
    vi.spyOn(productService, 'findProductById').mockResolvedValue({ spec: { basicData: { version: '1.0.0' } } });
    vi.spyOn(logService, 'createLog').mockResolvedValue();
    const { req, emit } = fakeReq();

    dispatchIoError(new FeatureSelectionInvalidError('boom'), req);

    await vi.waitFor(() => expect(emit).toHaveBeenCalled());
    expect(emit.mock.calls[0][1].message).toBe('error_messages.feature_selection_error');

    vi.restoreAllMocks();
  });

  it('otro código del core (LINE_PLATFORM_NOT_FOUND) también despacha por .code', async () => {
    vi.spyOn(productService, 'findProductById').mockResolvedValue({ spec: { basicData: { version: '1.0.0' } } });
    vi.spyOn(logService, 'createLog').mockResolvedValue();
    const { req, emit } = fakeReq();

    dispatchIoError(new LinePlatformNotFoundError('boom'), req);

    await vi.waitFor(() => expect(emit).toHaveBeenCalled());
    expect(emit.mock.calls[0][1].message).toBe('error_messages.line_platform_not_found');

    vi.restoreAllMocks();
  });

  it('sigue cayendo por nombre para los errores del monolito, sin .code', async () => {
    vi.spyOn(productService, 'findProductById').mockResolvedValue({ spec: { basicData: { version: '1.0.0' } } });
    vi.spyOn(logService, 'createLog').mockResolvedValue();
    const { req, emit } = fakeReq();

    dispatchIoError(new PermissionError('boom'), req);

    await vi.waitFor(() => expect(emit).toHaveBeenCalled());
    expect(emit.mock.calls[0][1].message).toBe('error_messages.permission_error');

    vi.restoreAllMocks();
  });

  it('ProductSpecUnavailableError (por nombre, sin .code) despacha el mismo mensaje que el 503 HTTP', async () => {
    vi.spyOn(productService, 'findProductById').mockResolvedValue({ spec: { basicData: { version: '1.0.0' } } });
    vi.spyOn(logService, 'createLog').mockResolvedValue();
    const { req, emit } = fakeReq();

    dispatchIoError(new ProductSpecUnavailableError('boom'), req);

    await vi.waitFor(() => expect(emit).toHaveBeenCalled());
    expect(emit.mock.calls[0][1].message).toBe('error_messages.product_spec_unavailable');

    vi.restoreAllMocks();
  });
});

describe('emitError: el 503 HTTP siempre sale, el evento WS no está garantizado si GitLab está caído', () => {
  it('cuando la propia llamada interna a GitLab (findProductById) falla, no se emite nada por WS — se traga en silencio', async () => {
    vi.spyOn(productService, 'findProductById').mockRejectedValue(new Error('GitLab is down'));
    vi.spyOn(logService, 'createLog').mockResolvedValue();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { req, emit } = fakeReq();

    dispatchIoError(new ProductSpecUnavailableError('spec unavailable'), req);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(emit).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});

describe('OPT-005: a failing template is logged with its real cause', () => {
  it('emits template_error with the detail and writes the log row with the product id', async () => {
    vi.spyOn(productService, 'findProductById').mockResolvedValue({ spec: { basicData: { version: '1.0.0' } } });
    const createLog = vi.spyOn(logService, 'createLog').mockResolvedValue();
    const { req, emit } = fakeReq();

    dispatchIoError(new TemplateError("Cannot read properties of undefined (reading 'sensors')"), req);

    await vi.waitFor(() => expect(createLog).toHaveBeenCalled());
    expect(emit.mock.calls[0][1]).toMatchObject({ type: 'error', message: 'error_messages.template_error', detail: expect.stringContaining('sensors') });
    expect(createLog.mock.calls[0][0]).toMatchObject({ productId: 'product-1', message: 'error_messages.template_error', params: [expect.stringContaining('sensors')] });

    vi.restoreAllMocks();
  });

  it('also logs the failure on a nested route that names the param `productId`', async () => {
    vi.spyOn(productService, 'findProductById').mockResolvedValue({ spec: { basicData: { version: '1.0.0' } } });
    const createLog = vi.spyOn(logService, 'createLog').mockResolvedValue();
    const { req } = fakeReq();
    req.params = { productId: 'product-9' };

    dispatchIoError(new TemplateError('boom'), req);

    await vi.waitFor(() => expect(createLog).toHaveBeenCalled());
    expect(createLog.mock.calls[0][0].productId).toBe('product-9');

    vi.restoreAllMocks();
  });
});
