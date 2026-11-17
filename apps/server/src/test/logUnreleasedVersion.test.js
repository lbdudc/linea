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
const productId = new mongoose.Types.ObjectId();
const at = (iso) => new Date(iso);

const write = (version, createdAt, message = 'log.downloaded_spl', type = 'info') =>
  new Log({ productId, version, type, message, createdAt }).save();

// a generation that finds nothing to commit has logged under a version that never existed: only what it wrote is dropped
test('drops the logs a generation wrote under its candidate version, and keeps what came before', async () => {
  await write('0.0.2', at('2026-01-01T10:00:00Z'), 'log.merged_merge_request');
  await write('0.0.1', at('2026-01-02T10:00:00Z'), 'log.merged_merge_request');
  await write('0.0.2', at('2026-01-02T10:00:01Z'));

  await repository.deleteByProductIdAndVersionSince(productId, '0.0.2', at('2026-01-02T10:00:00Z'));

  const versions = await repository.findVersionsByProductId(productId);
  expect(versions.sort()).toEqual(['0.0.1', '0.0.2']);
  const kept = await repository.findByProductIdAndVersionOrderByCreatedAtAsc(productId, '0.0.2');
  expect(kept.map((l) => l.message)).toEqual(['log.merged_merge_request']);
});

test('without earlier logs the candidate version leaves the history altogether', async () => {
  await write('0.0.1', at('2026-01-02T10:00:00Z'), 'log.merged_merge_request');
  await write('0.0.2', at('2026-01-02T10:00:01Z'));

  await repository.deleteByProductIdAndVersionSince(productId, '0.0.2', at('2026-01-02T10:00:00Z'));

  expect(await repository.findVersionsByProductId(productId)).toEqual(['0.0.1']);
});

// a generation that failed leaves its error logs under the version it never created
test('a version only a failed generation wrote is not part of the history', async () => {
  await write('0.0.1', at('2026-01-02T10:00:00Z'), 'log.merged_merge_request');
  await write('0.0.2', at('2026-01-03T10:00:00Z'));
  await write('0.0.2', at('2026-01-03T10:00:01Z'), 'The product does not fit its SPL', 'error');
  await write('0.0.3', at('2026-01-04T10:00:00Z'), 'log.generated_product');
  await write('0.0.3', at('2026-01-04T10:00:01Z'), 'error_messages.error_merging', 'error');

  expect(await repository.findVersionsByProductId(productId)).toEqual(['0.0.1']);
});

test('a version that was retried after a failure counts once it merged', async () => {
  await write('0.0.2', at('2026-01-03T10:00:00Z'), 'error_messages.error_merging', 'error');
  await write('0.0.2', at('2026-01-03T11:00:00Z'), 'log.merged_merge_request_deleted');

  expect(await repository.findVersionsByProductId(productId)).toEqual(['0.0.2']);
});
