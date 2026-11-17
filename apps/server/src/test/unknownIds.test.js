import { test, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Container } from 'typedi';
import LineService from '../model/services/LineService.js';
import ProductService from '../model/services/ProductService.js';
import { LineNotFoundError, ProductNotFoundError } from '../model/errors/errors.js';
import { onError } from '../rest/common/onError.js';
import { setup, clear, teardown } from './setup.js';

const lineService = Container.get(LineService);
const productService = Container.get(ProductService);

beforeAll(setup);
beforeEach(clear);
afterAll(teardown);

const UNKNOWN = '000000000000000000000000';
const MALFORMED = 'zzz';

test.each([UNKNOWN, MALFORMED])('a line id nobody has (%s) is a LineNotFoundError, not a TypeError', async (id) => {
  await expect(lineService.findLineById({ id, userId: 'u' })).rejects.toBeInstanceOf(LineNotFoundError);
});

test.each([UNKNOWN, MALFORMED])('a product id nobody has (%s) is a ProductNotFoundError, not a TypeError', async (id) => {
  await expect(productService.findProductById({ id, userId: 'u' })).rejects.toBeInstanceOf(ProductNotFoundError);
});

test('onError answers 404 for both', async () => {
  const app = express();
  app.get('/line', (req, res, next) => next(new LineNotFoundError()));
  app.get('/product', (req, res, next) => next(new ProductNotFoundError()));
  app.use(onError);

  expect((await request(app).get('/line')).status).toBe(404);
  expect((await request(app).get('/product')).body).toEqual({ error: 'error_messages.product_not_found' });
});
