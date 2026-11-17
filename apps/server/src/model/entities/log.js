import mongoose from 'mongoose';

const logSchema = new mongoose.Schema({
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    // Snapshots of the product's (and its line's) name at log time — both are
    // live references that can be deleted later, at which point deployment
    // history for them would otherwise have no name left to show.
    productName: {
      type: String,
      required: false
    },
    lineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Line'
    },
    lineName: {
      type: String,
      required: false
    },
    version: {
      type: String,
      required: true
    },
    type: {
      type: String,
      required: true
    },
    link: {
      type: String,
      required: false
    },
    message: {
      type: String,
      required: true
    },
    params: {
      type: Array,
      required: false
    },
    // how long the step this line closes took, in milliseconds
    durationMs: {
      type: Number,
      required: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  });

const Log = mongoose.model('Log', logSchema);

export default Log;