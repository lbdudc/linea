import mongoose from 'mongoose';

// The release of the tag of one version of a line or a product, as LINEA knows it: the changelog it generated (a cache, the host's release
// is the source of truth) or why the release could not be made. One row per version of a repository.
const versionReleaseSchema = new mongoose.Schema({
  host: { type: String, default: '' },
  projectId: { type: Number, required: true },
  kind: { type: String, enum: ['line', 'product'], required: true },
  version: { type: String, required: true },
  tag: { type: String, required: true },
  status: { type: String, enum: ['released', 'failed'], required: true },
  // where it failed: the tag, the changelog or the release
  step: { type: String, enum: ['tag', 'changelog', 'release'] },
  error: { type: String },
  // { from, to, truncated, markdown, sections, mergeRequests, issues }
  changelog: { type: mongoose.Schema.Types.Mixed },
  attempts: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

versionReleaseSchema.index({ host: 1, projectId: 1, version: 1 }, { unique: true });

export default mongoose.model('VersionRelease', versionReleaseSchema);
