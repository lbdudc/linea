// Which pipeline belongs to which version of a product.
//
// A host answers "the pipelines of this repository", not "the pipeline of version 1.2.0": the tag of a version is on another
// branch than the one that runs them. What is known is when each version was generated, so a pipeline belongs to the version
// whose generation it started in: the newest one that began between the start of that generation (a minute earlier: the clocks
// of the server and the host are not the same) and the start of the next one.
const MARGIN_MS = 60 * 1000;

/**
 * @param deployments [{ version, startedAt }] of one product, in any order
 * @param pipelines   [{ id, status, createdAt, webUrl, sha, ref }] in any order
 * @returns { [version]: pipeline }  only for the versions that have one
 */
export function pipelinesByVersion({ deployments, pipelines, marginMs = MARGIN_MS }) {
  const ordered = [...deployments]
    .filter((d) => d.version && d.startedAt)
    .map((d) => ({ version: d.version, from: new Date(d.startedAt).getTime() - marginMs }))
    .sort((a, b) => a.from - b.from);
  const timed = pipelines
    .map((p) => ({ ...p, at: new Date(p.createdAt).getTime() }))
    .filter((p) => Number.isFinite(p.at));

  const out = {};
  ordered.forEach((d, i) => {
    const until = i + 1 < ordered.length ? ordered[i + 1].from : Infinity;
    const inside = timed.filter((p) => p.at >= d.from && p.at < until).sort((a, b) => b.at - a.at);
    if (inside.length) {
      const { at, ...pipeline } = inside[0];
      out[d.version] = pipeline;
    }
  });
  return out;
}
