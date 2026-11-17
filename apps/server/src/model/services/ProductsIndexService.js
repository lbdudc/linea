import { Container } from 'typedi';
import {
  parseProductsIndex, serializeProductsIndex,
  addProductToIndex, renameProductInIndex,
  emptyProductsIndex, ProductsIndexError, PRODUCTS_INDEX_PATH,
} from '@lbdudc/linea-core';
import { getGitProvider } from '../git/index.js';
import { sleep, backoffDelay, isRetryableConflict, isNotFound } from './gitRetry.js';

const MAX_ATTEMPTS = 5;
const DEFAULT_REF = 'main';

export default class ProductsIndexService {
  #locks = new Map();

  #withLineLock = (lineProjectId, fn) => {
    const previous = this.#locks.get(lineProjectId) ?? Promise.resolve();
    const settled = previous.catch(() => {});
    const result = settled.then(fn);
    this.#locks.set(lineProjectId, result.catch(() => {}));
    return result;
  };

  #readIndex = async ({ token, lineProjectId, ref, host }) => {
    let meta;
    try {
      meta = await getGitProvider({ host }).getFileRevision({ token, id: lineProjectId, path: PRODUCTS_INDEX_PATH, ref });
    } catch (err) {
      if (isNotFound(err)) return { index: emptyProductsIndex(), lastCommitId: null };
      throw err;
    }
    const content = Buffer.from(meta.content, 'base64').toString('utf8');
    return { index: parseProductsIndex({ content }), lastCommitId: meta.revision };
  };

  #commitMutation = async ({ token, lineProjectId, ref = DEFAULT_REF, mutate, commitMessage, host }) => {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { index, lastCommitId } = await this.#readIndex({ token, lineProjectId, ref, host });
      const newIndex = mutate(index);

      const newContent = serializeProductsIndex({ index: newIndex });
      const currentContent = serializeProductsIndex({ index });
      if (newContent === currentContent) {
        return { index, attempts: attempt, committed: false };
      }

      const action = lastCommitId
        ? { action: 'update', path: PRODUCTS_INDEX_PATH, content: newContent, expectedRevision: lastCommitId }
        : { action: 'create', path: PRODUCTS_INDEX_PATH, content: newContent };

      try {
        await getGitProvider({ host }).commit({ token, id: lineProjectId, branch: ref, message: commitMessage, actions: [action], track: false });
        return { index: newIndex, attempts: attempt, committed: true };
      } catch (err) {
        lastError = err;
        if (!isRetryableConflict(err) || attempt === MAX_ATTEMPTS) break;
        await sleep(backoffDelay(attempt));
      }
    }
    throw new ProductsIndexError(
      `products.json on line project ${lineProjectId} did not converge after ${MAX_ATTEMPTS} attempts: ${lastError?.message ?? lastError}`,
      { cause: lastError }
    );
  };

  addProduct = async ({ token, lineProjectId, ref = DEFAULT_REF, name, repositorio, version, host }) =>
    this.#withLineLock(`${host ?? ''}|${lineProjectId}`, () =>
      this.#commitMutation({
        token, lineProjectId, ref, host,
        commitMessage: `products.json: add ${name}`,
        mutate: (index) => {
          try {
            return addProductToIndex({ index, product: { name, repositorio, version } });
          } catch (err) {
            if (err instanceof ProductsIndexError) {
              const existing = index.productos.find((p) => p.name === name);
              if (existing && existing.repositorio === repositorio) return index;
            }
            throw err;
          }
        },
      })
    );

  renameProduct = async ({ token, lineProjectId, ref = DEFAULT_REF, from, to, host }) =>
    this.#withLineLock(`${host ?? ''}|${lineProjectId}`, () =>
      this.#commitMutation({
        token, lineProjectId, ref, host,
        commitMessage: `products.json: rename ${from} -> ${to}`,
        mutate: (index) => {
          try {
            return renameProductInIndex({ index, from, to });
          } catch (err) {
            if (err instanceof ProductsIndexError) {
              const stillOld = index.productos.some((p) => p.name === from);
              const alreadyNew = index.productos.some((p) => p.name === to);
              if (!stillOld && alreadyNew) return index;
            }
            throw err;
          }
        },
      })
    );

  removeProduct = async ({ token, lineProjectId, ref = DEFAULT_REF, repositorio, host }) =>
    this.#withLineLock(`${host ?? ''}|${lineProjectId}`, () =>
      this.#commitMutation({
        token, lineProjectId, ref, host,
        commitMessage: `products.json: remove ${repositorio}`,
        mutate: (index) => ({
          productos: index.productos
            .filter((entry) => entry.repositorio !== repositorio)
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
        }),
      })
    );
}

Container.set(ProductsIndexService, new ProductsIndexService());
