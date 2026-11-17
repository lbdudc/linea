import mongoose from 'mongoose';

// Who changed what in the configuration of this LINEA, and when. Written by `model/audit.js`; nothing edits an entry.
const auditEntrySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true },
  actor: { id: String, username: String },
  action: { type: String, required: true, index: true },
  target: { type: String },
  detail: { type: mongoose.Schema.Types.Mixed },
  ip: { type: String },
});

export default mongoose.model('AuditEntry', auditEntrySchema);
