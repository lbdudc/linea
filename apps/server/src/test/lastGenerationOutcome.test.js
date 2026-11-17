import mongoose from 'mongoose';
import { Container } from 'typedi';
import { test, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Log from '../model/entities/log.js';
import LogRepository from '../model/repositories/LogRepository.js';
import { setup, clear, teardown } from './setup.js';

beforeAll(setup);
afterEach(clear);
afterAll(teardown);

const repository = Container.get(LogRepository);
const failing = new mongoose.Types.ObjectId();
const recovered = new mongoose.Types.ObjectId();
const untouched = new mongoose.Types.ObjectId();
const at = (iso) => new Date(iso);

const write = (productId, version, createdAt, type, message = 'log.step') =>
  new Log({ productId, version, type, message, createdAt }).save();

test('the last generation of each product is how its latest attempt ended', async () => {
  await write(failing, '0.0.1', at('2026-01-01T10:00:00Z'), 'success');
  await write(failing, '0.0.2', at('2026-01-02T10:00:00Z'), 'error');
  await write(recovered, '0.0.1', at('2026-01-01T10:00:00Z'), 'error');
  await write(recovered, '0.0.1', at('2026-01-01T10:05:00Z'), 'success');

  const found = await repository.findLastOutcomeByProductIds([failing, recovered, untouched].map(String));

  expect(found[String(failing)]).toMatchObject({ outcome: 'error', version: '0.0.2' });
  expect(found[String(recovered)]).toMatchObject({ outcome: 'success', version: '0.0.1' });
  expect(found[String(untouched)]).toBeUndefined();
});

test('products that are not asked for are left out', async () => {
  await write(failing, '0.0.1', at('2026-01-01T10:00:00Z'), 'error');

  expect(await repository.findLastOutcomeByProductIds([String(recovered)])).toEqual({});
});
