import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  spec: {
    basicData: {
      name: {
        type: String,
        required: true
      },
      version: {
        type: String,
        default: '0.0.0'
      },
      createdAt: {
        type: Date,
        default: Date.now
      },
      database: {
        type: Object,
        default: {}
      },
      extra: {
        type: Object,
        default: {}
      },
      testEnvironment: {
        image: { type: String, default: '' },
        command: { type: String, default: '' },
      },
      languages: {
        type: [String],
        default: ['en', 'es', 'gl']
      },
      SRID: {
        type: String,
        default: '4326'
      }
    },
    dataModel: {
      cells: {
        type: Array,
        default: []
      }
    },
    features: {
      type: [String],
      default: []
    },
    statics: {
      type: Array,
      default: []
    },
    sensor: {
      dsl: {
        type: String,
        default: ''
      },
      parsed: {
        type: Object,
        default: null
      }
    }
  },
  lineId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Line',
    required: true
  },
  // the git host of its line (see Line.gitHost)
  gitHost: {
    type: String,
  },
  repo: {
    id: {
      type: Number
    },
    namespaceId: {
      type: Number,
    },
    webUrl: {
      type: String
    },
    webIdeUrl: {
      type: String
    }
  },
  // The last time a sync (not a generation) looked at the repository, and when the scheduler runs the next one.
  lastSyncAt: {
    type: Date,
    default: null
  },
  nextSyncAt: {
    type: Date,
    default: null,
    index: true
  },
  // `inherit`: what the line says (Line.sync); `custom`: this product's own schedule; `off`: never by the scheduler.
  sync: {
    mode: { type: String, enum: ['inherit', 'custom', 'off'], default: 'inherit' },
    preset: { type: String, enum: ['1h', '3h', '6h', '12h', '24h', 'weekly', 'cron'], default: '6h' },
    cron: { type: String, default: '' },
    behavior: { type: String, enum: ['inherit', 'check', 'mr', 'merge'], default: 'inherit' },
  },
  // How a generation of this product behaves by default (the bump the dialog proposes, and whether the update MR is merged).
  generation: {
    bump: { type: String, enum: ['patch', 'minor', 'major'], default: 'patch' },
    autoMerge: { type: Boolean, default: true },
  },
  // A generation whose checks did not pass: its merge request waits for a person, with what recording the deployment will need.
  pendingUpdate: {
    type: new mongoose.Schema({ number: Number, version: String, data: String }, { _id: false }),
    default: null,
  },
  archived: {
    type: Boolean,
    default: false,
  },
  // The full spec lives in .linea/spec.draft.json; `spec` here is only the index (name, version, createdAt).
  specInRepo: {
    type: Boolean,
    default: false,
  },
  specFiller: {
    type: Boolean,
    default: false,
  },
});

const Product = mongoose.model('Product', productSchema);

export default Product;
