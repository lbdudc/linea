import mongoose from 'mongoose';

// One sync of a product: the scheduler's or a person's. It is not a version: a sync never raises it.
const syncRunSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  lineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Line', required: true },
  trigger: { type: String, enum: ['manual', 'cron'], required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  behavior: { type: String, enum: ['check', 'mr', 'merge'], required: true },
  status: { type: String, enum: ['running', 'unchanged', 'drift', 'mr', 'merged', 'failed', 'skipped'], default: 'running' },
  // the version of the product (unchanged by the sync) and the version of the line it was derived against
  version: { type: String },
  lineVersion: { type: String },
  files: { type: Number, default: 0 },
  // what the sync did to the features the product has (the SPL gained a mandatory one, or lost one the selection named)
  featuresAdded: { type: [String], default: undefined },
  featuresRemoved: { type: [String], default: undefined },
  mr: { number: Number, url: String },
  reason: { type: String },
  startedAt: { type: Date, default: Date.now },
  finishedAt: { type: Date },
});

syncRunSchema.index({ productId: 1, startedAt: -1 });

export default mongoose.model('SyncRun', syncRunSchema);
