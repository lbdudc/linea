import mongoose from 'mongoose';

// What an administrator decided about how this LINEA behaves (sign-in, modules, audit): one document per setting. The file wins over it.
const instanceSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed },
});

const InstanceSetting = mongoose.model('InstanceSetting', instanceSettingSchema);

/** The store the instance settings use: `all()` -> { key: value }, `set(key, value)`, `unset(key)`. */
export const mongoInstanceStore = {
  all: async () => Object.fromEntries((await InstanceSetting.find().lean()).map(({ key, value }) => [key, value])),
  set: async (key, value) => { await InstanceSetting.findOneAndUpdate({ key }, { $set: { value }, $setOnInsert: { key } }, { upsert: true }); },
  unset: async (key) => { await InstanceSetting.deleteOne({ key }); },
};

export default InstanceSetting;
