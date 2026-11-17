import path from 'node:path'
import { NAME_PATTERN, PRODUCTS_INDEX_PATH, VERSION_PATTERN } from '../constants.js'
import { InvalidArgumentError, ProductsIndexError } from '../errors.js'
import { fileExists, readTextFile, writeTextFile } from '../fs/workspace.js'
import { isArray, isPlainObject } from '../internal/guards.js'

export interface ProductsIndexEntry {
  readonly name: string
  readonly repositorio: string
  readonly version?: string
}

export interface ProductsIndex {
  readonly productos: ProductsIndexEntry[]
}

export interface ProductsIndexProblem {
  readonly path: string
  readonly code: ProductsIndexProblemCode
  readonly messageKey: string
}

export type ProductsIndexProblemCode =
  | 'INDEX_NOT_OBJECT'
  | 'PRODUCTOS_NOT_ARRAY'
  | 'ENTRY_NOT_OBJECT'
  | 'NAME_REQUIRED'
  | 'NAME_INVALID_CHARACTERS'
  | 'NAME_DUPLICATED'
  | 'REPOSITORIO_REQUIRED'
  | 'VERSION_INVALID_FORMAT'

export interface ProductsIndexValidation {
  readonly valid: boolean
  readonly errors: ProductsIndexProblem[]
}

const byName = (a: ProductsIndexEntry, b: ProductsIndexEntry): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0

const normalizeEntry = ({
  name,
  repositorio,
  version
}: ProductsIndexEntry): ProductsIndexEntry =>
  typeof version === 'string' && version !== ''
    ? { name, repositorio, version }
    : { name, repositorio }

const assertOptionalVersion = ({
  version,
  label
}: {
  version: unknown
  label: string
}): void => {
  if (version === undefined) return
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new InvalidArgumentError(
      `${label} must be a version like "1.2.3"; got ${JSON.stringify(version)}.`
    )
  }
}

const assertIndex = (index: unknown): ProductsIndex => {
  if (!isPlainObject(index) || !Array.isArray(index.productos)) {
    throw new InvalidArgumentError('"index" must be a { productos: [...] } object.')
  }
  return index as unknown as ProductsIndex
}

export const emptyProductsIndex = (): ProductsIndex => ({ productos: [] })

export const validateProductsIndex = ({ index }: { index: unknown }): ProductsIndexValidation => {
  if (!isPlainObject(index)) {
    return {
      valid: false,
      errors: [{
        path: '(root)',
        code: 'INDEX_NOT_OBJECT',
        messageKey: 'error_messages.products_index_not_object'
      }]
    }
  }
  if (!Array.isArray(index.productos)) {
    return {
      valid: false,
      errors: [{
        path: 'productos',
        code: 'PRODUCTOS_NOT_ARRAY',
        messageKey: 'error_messages.products_index_productos_not_array'
      }]
    }
  }

  const errors: ProductsIndexProblem[] = []
  const seen = new Set<string>()

  index.productos.forEach((entry: unknown, position: number) => {
    const at = `productos[${position}]`
    if (!isPlainObject(entry)) {
      errors.push({
        path: at,
        code: 'ENTRY_NOT_OBJECT',
        messageKey: 'error_messages.products_index_entry_not_object'
      })
      return
    }

    const { name, repositorio, version } = entry
    if (typeof name !== 'string' || name === '') {
      errors.push({
        path: `${at}.name`,
        code: 'NAME_REQUIRED',
        messageKey: 'error_messages.products_index_name_required'
      })
    } else if (!NAME_PATTERN.test(name)) {
      errors.push({
        path: `${at}.name`,
        code: 'NAME_INVALID_CHARACTERS',
        messageKey: 'error_messages.invalid_name_characters'
      })
    } else if (seen.has(name)) {
      errors.push({
        path: `${at}.name`,
        code: 'NAME_DUPLICATED',
        messageKey: 'error_messages.products_index_name_duplicated'
      })
    } else {
      seen.add(name)
    }

    if (typeof repositorio !== 'string' || repositorio === '') {
      errors.push({
        path: `${at}.repositorio`,
        code: 'REPOSITORIO_REQUIRED',
        messageKey: 'error_messages.products_index_repositorio_required'
      })
    }

    if (version !== undefined && (typeof version !== 'string' || !VERSION_PATTERN.test(version))) {
      errors.push({
        path: `${at}.version`,
        code: 'VERSION_INVALID_FORMAT',
        messageKey: 'error_messages.basicData_version_format'
      })
    }
  })

  return { valid: errors.length === 0, errors }
}

export const parseProductsIndex = ({ content }: { content: string }): ProductsIndex => {
  if (typeof content !== 'string') {
    throw new InvalidArgumentError('"content" must be a string.')
  }
  if (content.trim() === '') return emptyProductsIndex()

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new ProductsIndexError(
      `products.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  }

  const validation = validateProductsIndex({ index: parsed })
  if (!validation.valid) {
    const summary = validation.errors.map((e) => `${e.path}: ${e.messageKey}`).join('; ')
    throw new ProductsIndexError(`products.json does not satisfy the ADR-011 format: ${summary}`)
  }

  const index = parsed as ProductsIndex
  return { productos: index.productos.map(normalizeEntry) }
}

export const serializeProductsIndex = ({ index }: { index: ProductsIndex }): string => {
  const checked = assertIndex(index)
  const productos = [...checked.productos].sort(byName).map(normalizeEntry)
  return `${JSON.stringify({ productos }, null, 2)}\n`
}

export const addProductToIndex = ({
  index,
  product
}: {
  index: ProductsIndex
  product: ProductsIndexEntry
}): ProductsIndex => {
  const checked = assertIndex(index)
  if (!isPlainObject(product)) {
    throw new InvalidArgumentError('"product" must be a { name, repositorio } object.')
  }
  const { name, repositorio, version } = product
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new InvalidArgumentError(`Invalid product name ${JSON.stringify(name)}.`)
  }
  if (typeof repositorio !== 'string' || repositorio === '') {
    throw new InvalidArgumentError('"product.repositorio" must be a non-empty string.')
  }
  assertOptionalVersion({ version, label: '"product.version"' })
  if (checked.productos.some((entry) => entry.name === name)) {
    throw new ProductsIndexError(`Product "${name}" is already in the index.`)
  }

  return {
    productos: [...checked.productos, normalizeEntry({ name, repositorio, version })].sort(byName)
  }
}

export const renameProductInIndex = ({
  index,
  from,
  to
}: {
  index: ProductsIndex
  from: string
  to: string
}): ProductsIndex => {
  const checked = assertIndex(index)
  if (typeof from !== 'string' || from === '') {
    throw new InvalidArgumentError('"from" must be a non-empty string.')
  }
  if (typeof to !== 'string' || !NAME_PATTERN.test(to)) {
    throw new InvalidArgumentError(`Invalid product name ${JSON.stringify(to)}.`)
  }
  if (!checked.productos.some((entry) => entry.name === from)) {
    throw new ProductsIndexError(`Product "${from}" is not in the index.`)
  }
  if (from !== to && checked.productos.some((entry) => entry.name === to)) {
    throw new ProductsIndexError(`Product "${to}" is already in the index.`)
  }

  return {
    productos: checked.productos
      .map((entry) => (entry.name === from ? normalizeEntry({ ...entry, name: to }) : entry))
      .sort(byName)
  }
}

export const removeProductFromIndex = ({
  index,
  name
}: {
  index: ProductsIndex
  name: string
}): ProductsIndex => {
  const checked = assertIndex(index)
  if (typeof name !== 'string' || name === '') {
    throw new InvalidArgumentError('"name" must be a non-empty string.')
  }
  return { productos: checked.productos.filter((entry) => entry.name !== name).sort(byName) }
}

export const readProductsIndex = ({ lineDir }: { lineDir: string }): ProductsIndex => {
  if (typeof lineDir !== 'string' || lineDir.trim() === '') {
    throw new InvalidArgumentError('"lineDir" must be a non-empty path.')
  }
  const filePath = path.join(path.resolve(lineDir), PRODUCTS_INDEX_PATH)
  if (!fileExists({ filePath })) return emptyProductsIndex()
  return parseProductsIndex({ content: readTextFile({ filePath }) })
}

export const writeProductsIndex = ({
  lineDir,
  index
}: {
  lineDir: string
  index: ProductsIndex
}): { path: string } => {
  if (typeof lineDir !== 'string' || lineDir.trim() === '') {
    throw new InvalidArgumentError('"lineDir" must be a non-empty path.')
  }
  const content = serializeProductsIndex({ index })
  const filePath = path.join(path.resolve(lineDir), PRODUCTS_INDEX_PATH)
  return { path: writeTextFile({ filePath, content }) }
}

export interface ProductsIndexReconciliation {
  readonly index: ProductsIndex
  readonly added: ProductsIndexEntry[]
  readonly removed: ProductsIndexEntry[]
}

export const reconcileProductsIndex = ({
  index,
  repositories
}: {
  index: ProductsIndex
  repositories: readonly ProductsIndexEntry[]
}): ProductsIndexReconciliation => {
  const checked = assertIndex(index)
  if (!isArray(repositories)) {
    throw new InvalidArgumentError('"repositories" must be an array of { name, repositorio }.')
  }
  for (const repository of repositories) {
    if (!isPlainObject(repository) ||
      typeof repository.name !== 'string' || repository.name === '' ||
      typeof repository.repositorio !== 'string' || repository.repositorio === '') {
      throw new InvalidArgumentError(
        'Every entry of "repositories" must be a { name, repositorio } object with non-empty strings.'
      )
    }
    assertOptionalVersion({
      version: repository.version,
      label: `"repositories[${repository.name}].version"`
    })
  }

  const indexed = new Set(checked.productos.map((entry) => entry.name))
  const observed = new Set(repositories.map((repository) => repository.name))

  const added = repositories
    .filter((repository) => !indexed.has(repository.name))
    .map(normalizeEntry)

  const removed = checked.productos
    .filter((entry) => !observed.has(entry.name))
    .map(normalizeEntry)

  return {
    index: { productos: [...checked.productos, ...added].sort(byName) },
    added: [...added].sort(byName),
    removed: [...removed].sort(byName)
  }
}
