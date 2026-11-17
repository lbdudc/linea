import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deriveProduct,
  deriveProductToZip,
  extractArchive,
  FeatureModelEmptyError,
  FeatureSelectionInvalidError,
  InvalidArgumentError,
  LinePlatformNotFoundError,
  type ProductSpec
} from '../../src/index.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LPS_MIN = path.join(ROOT, 'test', 'fixtures', 'lps-min')

const created: string[] = []
const makeTmpDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-core-derive-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const listFiles = (dir: string, prefix = ''): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`]
  ).sort()

const read = (dir: string, relative: string): string =>
  fs.readFileSync(path.join(dir, ...relative.split('/')), 'utf8')

const specFor = (features: string[]): ProductSpec => ({
  basicData: { name: 'MyShop', version: '1.0.0' },
  features
})

describe('deriveProduct', () => {
  it('says the feature model has nothing in it when it is only its root', async () => {
    const lineDir = makeTmpDir()
    fs.cpSync(LPS_MIN, lineDir, { recursive: true })
    fs.writeFileSync(path.join(lineDir, 'src', 'platform', 'model.uvl'), 'features\n\tMyShop\n')

    const failure = await deriveProduct({ lineDir, spec: specFor([]), outputDir: makeTmpDir() }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(FeatureModelEmptyError)
    expect((failure as FeatureModelEmptyError).code).toBe('FEATURE_MODEL_EMPTY')
    expect((failure as Error).message).toBe('error_messages.feature_model_empty')
  })

  it('generates the files of the selected features', async () => {
    const outputDir = makeTmpDir()
    const { outputDir: out } = await deriveProduct({
      lineDir: LPS_MIN,
      spec: specFor(['Shop', 'Payment', 'CreditCard']),
      outputDir
    })
    expect(out).toBe(path.resolve(outputDir))
    const files = listFiles(out)
    expect(files).toContain('README.md')
    expect(files).toContain('client/catalog.js')
    expect(files).toContain('server/payment.js')
  })

  it('omits the files of features that were not selected', async () => {
    const outputDir = makeTmpDir()
    const { outputDir: out } = await deriveProduct({
      lineDir: LPS_MIN,
      spec: specFor(['Shop', 'Catalog']),
      outputDir
    })
    const files = listFiles(out)
    expect(files).not.toContain('server/payment.js')
    expect(files).not.toContain('server/reporting.js')
    expect(files).toContain('client/catalog.js')
  })

  it('includes a feature-gated file once its feature is selected', async () => {
    const outputDir = makeTmpDir()
    const { outputDir: out } = await deriveProduct({
      lineDir: LPS_MIN,
      spec: specFor(['Shop', 'Reporting']),
      outputDir
    })
    expect(listFiles(out)).toContain('server/reporting.js')
    expect(read(out, 'server/reporting.js')).toContain('MYSHOP')
  })

  it('interpolates spec data and extra.js helpers', async () => {
    const outputDir = makeTmpDir()
    const { outputDir: out } = await deriveProduct({
      lineDir: LPS_MIN,
      spec: specFor(['Shop', 'Payment', 'Cash']),
      outputDir
    })
    expect(read(out, 'README.md')).toContain('MyShop')
    expect(read(out, 'README.md')).toContain('1.0.0')
    expect(read(out, 'client/catalog.js')).toContain('MyShop')
    const payment = read(out, 'server/payment.js')
    expect(payment).toContain('cash: true')
    expect(payment).toContain('creditCard: false')
  })

  it('creates outputDir when it does not exist', async () => {
    const outputDir = path.join(makeTmpDir(), 'deep', 'target')
    const { outputDir: out } = await deriveProduct({
      lineDir: LPS_MIN,
      spec: specFor(['Shop']),
      outputDir
    })
    expect(fs.statSync(out).isDirectory()).toBe(true)
  })

  it('DELETES NOTHING: lineDir and outputDir survive intact', async () => {
    const outputDir = makeTmpDir()
    const before = listFiles(LPS_MIN)
    const marker = path.join(outputDir, 'pre-existing.txt')
    fs.writeFileSync(marker, 'still here', 'utf8')

    await deriveProduct({ lineDir: LPS_MIN, spec: specFor(['Shop']), outputDir })

    expect(listFiles(LPS_MIN)).toEqual(before)
    expect(fs.existsSync(LPS_MIN)).toBe(true)
    expect(fs.readFileSync(marker, 'utf8')).toBe('still here')
  })

  it('leaves the line fixture byte-identical after a derivation', async () => {
    const modelPath = path.join(LPS_MIN, 'src', 'platform', 'model.uvl')
    const before = fs.readFileSync(modelPath)
    await deriveProduct({
      lineDir: LPS_MIN,
      spec: specFor(['Shop']),
      outputDir: makeTmpDir()
    })
    expect(fs.readFileSync(modelPath).equals(before)).toBe(true)
  })

  it('throws FeatureSelectionInvalidError for an invalid selection', async () => {
    const outputDir = makeTmpDir()
    await expect(deriveProduct({
      lineDir: LPS_MIN,
      spec: specFor(['NoSuchFeature']),
      outputDir
    })).rejects.toThrow(FeatureSelectionInvalidError)
  })

  it('reports an invalid selection with the stable code and a real reason', async () => {
    try {
      await deriveProduct({
        lineDir: LPS_MIN,
        spec: specFor(['NoSuchFeature']),
        outputDir: makeTmpDir()
      })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(FeatureSelectionInvalidError)
      expect((error as FeatureSelectionInvalidError).code).toBe('FEATURE_SELECTION_INVALID')
      expect((error as Error).message).not.toBe('[object Object]')
      expect((error as FeatureSelectionInvalidError).cause).toBeDefined()
    }
  })

  it('throws LinePlatformNotFoundError when the line has no src/platform', async () => {
    await expect(deriveProduct({
      lineDir: makeTmpDir(),
      spec: specFor(['Shop']),
      outputDir: makeTmpDir()
    })).rejects.toThrow(LinePlatformNotFoundError)
  })

  it('throws LinePlatformNotFoundError when the platform has no code directory', async () => {
    const lineDir = makeTmpDir()
    const platform = path.join(lineDir, 'src', 'platform')
    fs.mkdirSync(platform, { recursive: true })
    fs.copyFileSync(path.join(LPS_MIN, 'src/platform/model.uvl'), path.join(platform, 'model.uvl'))
    await expect(deriveProduct({
      lineDir,
      spec: specFor(['Shop']),
      outputDir: makeTmpDir()
    })).rejects.toThrow(LinePlatformNotFoundError)
  })

  it('reports a missing template helper with the monolith i18n key', async () => {
    const lineDir = makeTmpDir()
    fs.cpSync(LPS_MIN, lineDir, { recursive: true })
    fs.writeFileSync(
      path.join(lineDir, 'src/platform/code/client/catalog.js'),
      'export const x = "/*%= thisHelperDoesNotExist(data) %*/";\n',
      'utf8'
    )
    try {
      await deriveProduct({ lineDir, spec: specFor(['Shop']), outputDir: makeTmpDir() })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(LinePlatformNotFoundError)
      expect((error as Error).message).toBe('error_messages.missing_function_error')
      expect((error as LinePlatformNotFoundError).cause).toBeInstanceOf(ReferenceError)
    }
  })

  describe('catch-all: a broken platform reports why', () => {
    const brokenLine = (mutate: (platform: string) => void): string => {
      const lineDir = makeTmpDir()
      fs.cpSync(LPS_MIN, lineDir, { recursive: true })
      mutate(path.join(lineDir, 'src', 'platform'))
      return lineDir
    }

    type BrokenCase = readonly [string, (platform: string) => void, RegExp]
    const cases: readonly BrokenCase[] = [
      ['config.json holds invalid JSON',
        (p) => { fs.writeFileSync(path.join(p, 'config.json'), '{,}', 'utf8') },
        /JSON/i],
      ['config.json is missing',
        (p) => { fs.rmSync(path.join(p, 'config.json')) },
        /ENOENT/],
      ['transformation.js is missing',
        (p) => { fs.rmSync(path.join(p, 'transformation.js')) },
        /ENOENT/],
      ['the feature model does not parse',
        (p) => { fs.writeFileSync(path.join(p, 'model.uvl'), 'esto no es un modelo\n', 'utf8') },
        /mismatched input/i]
    ]

    it.each(cases)('%s', async (_name, mutate, expectedMessage) => {
      const lineDir = brokenLine(mutate)
      try {
        await deriveProduct({ lineDir, spec: specFor(['Shop']), outputDir: makeTmpDir() })
        expect.unreachable('should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(LinePlatformNotFoundError)
        expect((error as Error).message).toMatch(expectedMessage)
      }
    })
  })

  it('rejects malformed arguments', async () => {
    const outputDir = makeTmpDir()
    await expect(deriveProduct({ lineDir: '', spec: specFor(['Shop']), outputDir }))
      .rejects.toThrow(InvalidArgumentError)
    await expect(deriveProduct({ lineDir: LPS_MIN, spec: specFor(['Shop']), outputDir: '' }))
      .rejects.toThrow(InvalidArgumentError)
    await expect(deriveProduct({
      lineDir: LPS_MIN,
      spec: null as unknown as ProductSpec,
      outputDir
    })).rejects.toThrow(InvalidArgumentError)
  })
})

describe('deriveProductToZip', () => {
  it('returns a non-empty archive', async () => {
    const zip = await deriveProductToZip({
      lineDir: LPS_MIN,
      spec: specFor(['Shop', 'Payment', 'CreditCard'])
    })
    expect(zip.length).toBeGreaterThan(0)
    expect(zip.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('produces exactly what deriveProduct writes to disk', async () => {
    const spec = specFor(['Shop', 'Payment', 'Cash', 'Reporting'])

    const direct = await deriveProduct({ lineDir: LPS_MIN, spec, outputDir: makeTmpDir() })
    const zip = await deriveProductToZip({ lineDir: LPS_MIN, spec })
    const extracted = await extractArchive({ source: zip, destDir: makeTmpDir() })

    expect(listFiles(extracted.dir)).toEqual(listFiles(direct.outputDir))
    for (const relative of listFiles(direct.outputDir)) {
      expect(read(extracted.dir, relative), relative).toBe(read(direct.outputDir, relative))
    }
  })

  it('names its files with forward slashes on any system', async () => {
    const lineDir = makeTmpDir()
    fs.cpSync(LPS_MIN, lineDir, { recursive: true })
    const nested = path.join(lineDir, 'src', 'platform', 'code', 'server', 'api', 'v1')
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(nested, 'routes.txt'), 'routes\n')

    const zip = await deriveProductToZip({ lineDir, spec: specFor(['Shop', 'Payment', 'Cash']) })
    const names: string[] = []
    for (let at = zip.indexOf('PK\u0001\u0002', 0, 'latin1'); at >= 0; at = zip.indexOf('PK\u0001\u0002', at + 4, 'latin1')) {
      names.push(zip.toString('utf8', at + 46, at + 46 + zip.readUInt16LE(at + 28)))
    }
    expect(names).toContain('server/api/v1/routes.txt')
    expect(names.filter((name) => name.includes('\\'))).toEqual([])
  })

  it('applies the same feature gating as deriveProduct', async () => {
    const zip = await deriveProductToZip({ lineDir: LPS_MIN, spec: specFor(['Shop', 'Catalog']) })
    const { dir } = await extractArchive({ source: zip, destDir: makeTmpDir() })
    expect(listFiles(dir)).not.toContain('server/payment.js')
  })

  it('throws FeatureSelectionInvalidError for an invalid selection', async () => {
    await expect(deriveProductToZip({ lineDir: LPS_MIN, spec: specFor(['NoSuchFeature']) }))
      .rejects.toThrow(FeatureSelectionInvalidError)
  })

  it('throws LinePlatformNotFoundError when the line has no platform', async () => {
    await expect(deriveProductToZip({ lineDir: makeTmpDir(), spec: specFor(['Shop']) }))
      .rejects.toThrow(LinePlatformNotFoundError)
  })

  it('writes nothing at all', async () => {
    const before = listFiles(LPS_MIN)
    await deriveProductToZip({ lineDir: LPS_MIN, spec: specFor(['Shop']) })
    expect(listFiles(LPS_MIN)).toEqual(before)
  })

  it('rejects malformed arguments', async () => {
    await expect(deriveProductToZip({ lineDir: '', spec: specFor(['Shop']) }))
      .rejects.toThrow(InvalidArgumentError)
    await expect(deriveProductToZip({ lineDir: LPS_MIN, spec: 'nope' as unknown as ProductSpec }))
      .rejects.toThrow(InvalidArgumentError)
  })
})

const MOCK_LPS = path.resolve(ROOT, '..', 'linea', 'server', 'src', 'test', 'mocks', 'lps')
const runSlow = process.env.LINEA_SLOW_TESTS !== undefined && fs.existsSync(MOCK_LPS)

describe.skipIf(!runSlow)('deriveProduct against the real mock LPS (slow)', () => {
  it('derives the GEMA platform', async () => {
    const { outputDir } = await deriveProduct({
      lineDir: MOCK_LPS,
      spec: {
        basicData: { name: 'GemaDemo', version: '1.0.0', languages: ['en'], SRID: '4326' },
        dataModel: { cells: [] },
        features: [
          'GEMA_SPL', 'DM_GT_Identity', 'MV_MS_GeoServer',
          'MV_MM_UniqueMapViewer', 'MV_MM_UMV_MC_BBox'
        ],
        statics: []
      },
      outputDir: makeTmpDir()
    })
    expect(listFiles(outputDir).length).toBeGreaterThan(0)
  }, 120_000)
})
