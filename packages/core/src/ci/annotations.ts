import { createEngine } from '../derivation/engine.js'

/** What an SPL's annotated code mentions: for each file (relative to `src/platform/code`) the features it tests and how many times. */
export type FeaturesByFile = Record<string, Record<string, number>>

interface AnalysisReportHandle {
  long: () => Record<string, { feature?: Record<string, number> }>
}

/** The features each file of the SPL's annotated code depends on, read from its annotations (no product is derived). */
export const analyzeAnnotations = async ({ lineDir }: { lineDir: string }): Promise<FeaturesByFile> => {
  const engine = await createEngine(lineDir) as unknown as { analyseAnnotations: () => Promise<AnalysisReportHandle> }
  const report = await engine.analyseAnnotations()
  const byFile: FeaturesByFile = {}
  for (const [file, result] of Object.entries(report.long())) {
    byFile[file.split('\\').join('/').replace(/^\.?\//, '')] = { ...(result.feature ?? {}) }
  }
  return byFile
}
