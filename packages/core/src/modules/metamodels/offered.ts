import { readPackageText } from '../packages/source.js'
import type { ResolvedSpl } from '../types.js'

/** A model a module offers, as the product editor shows it: read-only. */
export interface OfferedModel {
  /** Name of the module that offers it. */
  readonly origin: string
  readonly metamodel: string
  /** Location of the module, and the file in it. */
  readonly package: string
  readonly file: string
  readonly text: string
}

/** The models the modules of an SPL offer (the ones that exist; `checkSpl` says what is wrong with the others). */
export const listOfferedModels = async ({ resolved }: { resolved: ResolvedSpl }): Promise<OfferedModel[]> => {
  const offered: OfferedModel[] = []
  for (const module of resolved.modules) {
    for (const [metamodel, file] of Object.entries(module.manifest.offers)) {
      const text = await readPackageText({ files: module.files, path: file })
      if (text !== undefined) offered.push({ origin: module.manifest.name, metamodel, package: module.location, file, text })
    }
  }
  return offered
}
