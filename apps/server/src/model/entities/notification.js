import mongoose from 'mongoose';

const RETENTION_SECONDS = 90 * 24 * 60 * 60;

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // waiting: something waits for the person (a plugin acting for them says so: an agent's plan to approve, say)
  reason: { type: String, enum: ['assigned', 'mentioned', 'state', 'comment', 'failed', 'conflicts', 'stuck', 'waiting'], required: true },
  subject: { type: String, enum: ['issue', 'mr', 'run'], required: true },
  target: {
    kind: { type: String, enum: ['line', 'product', 'repo'], required: true },
    id: { type: String, required: true },
    name: { type: String },
  },
  number: { type: Number },
  alertKey: { type: String },
  title: { type: String },
  actor: { type: String },
  excerpt: { type: String },
  state: { type: String },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, read: 1 });
notificationSchema.index({ userId: 1, alertKey: 1 }, { unique: true, partialFilterExpression: { alertKey: { $type: 'string' } } });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

export default mongoose.model('Notification', notificationSchema);
