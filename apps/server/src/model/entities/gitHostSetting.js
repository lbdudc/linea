import mongoose from 'mongoose';

// What an administrator decided about a git host in the app (the file linea.config.yml wins over it): whether it is on, and its settings.
const gitHostSettingSchema = new mongoose.Schema({
  host: { type: String, required: true, unique: true },
  enabled: { type: Boolean },
  settings: { type: mongoose.Schema.Types.Mixed, default: {} },
});

const GitHostSetting = mongoose.model('GitHostSetting', gitHostSettingSchema);

/** The store the git hosts use: `all()` -> { host: { enabled, settings } }, `save(host, patch)`. */
export const mongoGitHostStore = {
  all: async () => Object.fromEntries((await GitHostSetting.find().lean()).map(({ host, enabled, settings }) => [host, { enabled, settings }])),
  save: async (host, patch) => {
    await GitHostSetting.findOneAndUpdate({ host }, { $set: patch, $setOnInsert: { host } }, { upsert: true });
  },
};

export default GitHostSetting;
