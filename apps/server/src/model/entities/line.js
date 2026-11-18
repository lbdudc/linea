import mongoose from 'mongoose';

const lineSchema = new mongoose.Schema({
  name: {
    type: String,
    unique: true,
    required: true,
  },
  // What the SPL is made of (`spl.json` in its repository): `plain` (the feature metamodel only: its user sees a feature model, not
  // a metamodel), `project` (the metamodels the user chose, the feature metamodel among them) or `modular` (made of modules).
  kind: {
    type: String,
    enum: ['plain', 'project', 'modular'],
    default: 'plain',
  },
  // The metamodels a `project` uses directly (locations); the feature metamodel is not listed: every SPL has it.
  metamodels: {
    type: [String],
    required: false,
  },
  version: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: false,
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  // The git host the line lives on (`gitlab`, `github`); unset: the deployment's primary host (the lines that were before there could be more than one).
  gitHost: {
    type: String,
  },
  repoId: {
    type: Number
  },
  // The access LINEA gave on the git host (`{ username, level }`: 20 reporter .. 50 owner): what LINEA writes to the repositories of the
  // line and its products, and what it compares the host with to see a change made there.
  access: { type: [{ _id: false, username: String, level: Number }], default: [] },
  // The GitLab group that *is* this line — set once the group has been created
  // (or discovered). Never a parent/default: the parent is chosen per creation
  // and passed to LineService.createLine as `parentNamespaceId`.
  namespaceId: {
    type: Number
  },
  webUrl: {
    type: String
  },
  webIdeUrl: {
    type: String
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  },
  archived: {
    type: Boolean,
    default: false,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
  deletedName: {
    type: String,
  },
  // What the products of this line inherit when they do not set their own (see Product.sync): the scheduler runs a sync
  // with `preset` (or `cron` when the preset is `cron`), and `behavior` says what a sync does with the drift it finds.
  sync: {
    enabled: { type: Boolean, default: false },
    preset: { type: String, enum: ['1h', '3h', '6h', '12h', '24h', 'weekly', 'cron'], default: '6h' },
    cron: { type: String, default: '' },
    behavior: { type: String, enum: ['check', 'mr', 'merge'], default: 'mr' },
  },
}, { toObject: { virtuals: true }, toJSON: { virtuals: true } });

// Made of modules rather than a platform of its own.
lineSchema.virtual('modular').get(function () {
  return this.kind === 'modular';
});

const Line = mongoose.model('Line', lineSchema);

export default Line;
