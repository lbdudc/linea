import mongoose from 'mongoose';

// A config file that was applied, with what each change replaced, so the last few can be undone.
const configImportSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  username: { type: String },
  at: { type: Date, default: Date.now },
  results: { type: [{ area: String, id: String, ok: Boolean, error: String }], default: [] },
  rows: { type: mongoose.Schema.Types.Mixed },
  before: { type: [mongoose.Schema.Types.Mixed], default: [] },
  rolledBackAt: { type: Date },
});

configImportSchema.index({ at: -1 });

export default mongoose.model('ConfigImport', configImportSchema);
