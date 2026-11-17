import mongoose from 'mongoose';

// What the deployment decided about a plugin of the catalog. The plugin itself (code, manifest) is on disk; this is only its switch.
const pluginSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  installed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: false },
  version: { type: String },
  settings: { type: mongoose.Schema.Types.Mixed, default: {} },
  installedAt: { type: Date },
});

const Plugin = mongoose.model('Plugin', pluginSchema);

/** The store the host uses: `all()`, `save(id, patch)`. The same shape is implemented in memory by the tests. */
export const mongoPluginStore = {
  all: async () => (await Plugin.find().lean()).map(({ _id, __v, ...record }) => record),
  save: async (id, patch) => {
    const saved = await Plugin.findOneAndUpdate({ id }, { $set: patch, $setOnInsert: { id } }, { upsert: true, new: true, lean: true });
    const { _id, __v, ...record } = saved;
    return record;
  },
};

export default Plugin;
