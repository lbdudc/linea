import productService from 'src/services/productService'
import { compareVersions } from 'src/utils/versions'

/** What the diff dialog shows while it waits, and what it shows when it has nothing. */
export const EMPTY_DIFF = { open: false, loading: false, before: null, after: null, models: null, title: '', from: '', to: '' }
export const LOADING_DIFF = { ...EMPTY_DIFF, open: true, loading: true }

/** The version that came before `version` in `versions`, or `null` when it is the first. */
export const previousVersionIn = (versions, version) =>
  versions.filter((other) => compareVersions(other, version) < 0).sort(compareVersions).at(-1) ?? null

/** What a version changed against the one before it, for the diff dialog. */
export const diffOfVersion = async ({ id, version, previous, t }) => {
  const snapshot = await productService.getVersion({ id, version, previous })
  const before = snapshot.previous
  return {
    open: true, loading: false, before: before?.spec ?? { basicData: {}, features: [] }, after: snapshot.spec,
    models: snapshot.models ? { deployed: before?.models ?? {}, saved: snapshot.models } : null,
    title: t('generation.version_changes_of', { version }),
    from: before ? `v${before.version}` : '—', to: `v${version}`,
  }
}

/** A version against what is saved now. */
export const diffVersionWithSaved = async ({ id, version, previous, t }) => {
  const snapshot = await productService.getVersion({ id, version, previous })
  const current = await productService.getDeployment({ id })
  return {
    open: true, loading: false, before: snapshot.spec, after: current.saved,
    models: snapshot.models ? { deployed: snapshot.models, saved: current.models?.saved ?? null } : null,
    title: t('generation.version_vs_saved', { version }), from: `v${version}`, to: '',
  }
}

/** Any two points of the history: a version number, or `savedPoint` for what is saved now. */
export const diffPoints = async ({ id, from, to, savedPoint, t }) => {
  const read = async (point) => {
    if (point === savedPoint) {
      const current = await productService.getDeployment({ id })
      return { label: t('generation.compare_saved'), spec: current.saved, models: current.models?.saved ?? null }
    }
    const snapshot = await productService.getVersion({ id, version: point })
    return { label: `v${point}`, spec: snapshot.spec, models: snapshot.models ?? null }
  }
  const [before, after] = await Promise.all([read(from), read(to)])
  return {
    open: true, loading: false, before: before.spec, after: after.spec,
    // the models are compared only when both sides kept them
    models: before.models && after.models ? { deployed: before.models, saved: after.models } : null,
    title: t('generation.compare_title', { from: before.label, to: after.label }),
    from: before.label, to: after.label,
  }
}
