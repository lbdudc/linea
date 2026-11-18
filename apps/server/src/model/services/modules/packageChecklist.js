const item = (id, status, params = {}) => ({ id, status, ...params });

/**
 * What the Release tab shows before anything is published: each thing publishing needs, as pass / warn / fail, so a person sees why
 * *Publish* will or will not work. Nothing here is a second check: it reads the report of `checkWorkingCopy`, the preview of
 * `previewPublication` and who may publish.
 */
export const buildChecklist = ({ manifest, manifestError, report, preview, canPublish, publishRule }) => {
  const errors = (report?.diagnostics ?? []).filter((d) => d.severity === 'error');
  const warnings = (report?.diagnostics ?? []).filter((d) => d.severity === 'warning');
  const checklist = [];
  checklist.push(manifestError ? item('manifest', 'fail', { detail: manifestError }) : item('manifest', 'pass', { version: manifest?.version }));
  if (preview) {
    if (preview.versionError) checklist.push(item('version', 'fail', { detail: preview.versionError }));
    else checklist.push(item('version', 'pass', { version: preview.version, latest: preview.latest }));
  }
  if (report) {
    checklist.push(errors.length
      ? item('resolves', 'fail', { count: errors.length, detail: errors[0].message })
      : item('resolves', 'pass', { count: report.resolved?.length ?? 0 }));
    if (warnings.length) checklist.push(item('warnings', 'warn', { count: warnings.length, detail: warnings[0].message }));
  }
  if (preview) {
    if (preview.warnings.length) checklist.push(item('bump', 'warn', { detail: preview.warnings[0], suggested: preview.suggestedBump }));
    else if (preview.suggestedBump) checklist.push(item('bump', 'pass', { suggested: preview.suggestedBump }));
    if (preview.commitsSince === 0) checklist.push(item('changes', 'warn', { latest: preview.latest }));
    else checklist.push(item('changes', 'pass', { count: preview.commitsSince, latest: preview.latest }));
  }
  checklist.push(canPublish ? item('permission', 'pass', { rule: publishRule }) : item('permission', 'fail', { rule: publishRule }));
  return checklist;
};
