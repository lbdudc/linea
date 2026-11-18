import mongoose from 'mongoose';

export const RULE_DEFAULTS = { failed: true, conflicts: true, stuck: true, stuckMinutes: 30, lineIds: [] };

const notificationRuleSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  failed: { type: Boolean, default: RULE_DEFAULTS.failed },
  conflicts: { type: Boolean, default: RULE_DEFAULTS.conflicts },
  stuck: { type: Boolean, default: RULE_DEFAULTS.stuck },
  stuckMinutes: { type: Number, default: RULE_DEFAULTS.stuckMinutes, min: 5, max: 1440 },
  lineIds: { type: [String], default: [] },
});

export default mongoose.model('NotificationRule', notificationRuleSchema);
