/**
 * Gives a dev database a deployment history: generations spread over the last 90 days, with a different story per line
 * (one steady, one that was failing and got fixed, one that broke this week, one that conflicts), so the home page has
 * something to draw. Deployments are made of logs (one per step), so this writes logs with past dates straight into Mongo:
 * the API only logs "now".
 *
 *   node dev/seed-history.mjs             (mongodb://127.0.0.1:27017/splalm?replicaSet=rs0; MONGO_URL=… DB=… to change it)
 *   node dev/seed-history.mjs --clean     (removes what this script wrote, and only that: they carry `seed: 'demo-history'`)
 *
 * Run it against a dev stack only. It is additive and can be run again after --clean.
 */
import { MongoClient } from 'mongodb';

const URL = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/?replicaSet=rs0';
const DB = process.env.DB ?? 'splalm';
const MARK = 'demo-history';
const DAY = 86_400_000;
const HISTORY_DAYS = 90;

// a small deterministic generator, so a run is the same as the last one
let state = 20261014;
const random = () => {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
};
const between = (a, b) => a + random() * (b - a);
const pick = (list) => list[Math.floor(random() * list.length)];

// how each line behaves: how many deployments a product gets, and the chance of an error / a conflict `daysAgo` days ago
const PROFILES = [
  { match: /customer-portal/i, perProduct: [10, 16], error: () => 0.04, warning: () => 0.05 },
  { match: /field-operations/i, perProduct: [6, 10], error: () => 0.08, warning: () => 0.22 },
  // failing at the start, fixed over time
  { match: /gis-platform/i, perProduct: [6, 9], error: (ago) => 0.12 + 0.45 * Math.min(1, ago / HISTORY_DAYS), warning: () => 0.06 },
  { match: /back-office/i, perProduct: [2, 5], error: () => 0.05, warning: () => 0.08 },
];
const DEFAULT_PROFILE = { perProduct: [1, 4], error: () => 0.12, warning: () => 0.1 };
// a regression: the last week most of what is deployed on this line fails
const REGRESSION = { match: /customer-portal/i, days: 5, error: 0.5 };

// weekdays and office hours, with the occasional weekend deploy
const WEEKDAY_WEIGHT = [0.05, 1, 1, 0.9, 0.9, 0.5, 0.08];

const when = (daysAgoMin, daysAgoMax, now) => {
  for (let i = 0; i < 20; i++) {
    const ago = between(daysAgoMin, daysAgoMax);
    const d = new Date(now - ago * DAY);
    if (random() < WEEKDAY_WEIGHT[d.getDay()]) {
      d.setHours(Math.floor(between(8, 19)), Math.floor(between(0, 60)), Math.floor(between(0, 60)), 0);
      if (d.getTime() < now) return d;
    }
  }
  return new Date(now - between(daysAgoMin, daysAgoMax) * DAY);
};

const client = await MongoClient.connect(URL);
const db = client.db(DB);
const logs = db.collection('logs');

if (process.argv.includes('--clean')) {
  const { deletedCount } = await logs.deleteMany({ seed: MARK });
  console.log(`removed ${deletedCount} logs`);
  await client.close();
  process.exit(0);
}

const already = await logs.countDocuments({ seed: MARK });
if (already > 0) {
  console.log(`there are ${already} logs from a previous run: node dev/seed-history.mjs --clean first`);
  await client.close();
  process.exit(1);
}

const user = await db.collection('users').findOne({ username: 'dev' }) ?? await db.collection('users').findOne({});
const lines = new Map((await db.collection('lines').find({}).toArray()).map((l) => [String(l._id), l]));
const products = (await db.collection('products').find({ archived: { $ne: true } }).toArray()).filter((p) => lines.has(String(p.lineId)));
// the products that have no log today are the ones that can have gone a while without a generation
const recentlySynced = new Set((await logs.aggregate([
  { $match: { createdAt: { $gte: new Date(Date.now() - 2 * DAY) } } },
  { $group: { _id: '$productId' } },
]).toArray()).map((r) => String(r._id)));

const now = Date.now();
const documents = [];
let deployments = 0;
const outcomes = { success: 0, warning: 0, error: 0 };

const log = (base, offsetMs, type, message, params = []) => ({
  ...base, type, message, params, createdAt: new Date(base.at.getTime() + offsetMs), seed: MARK,
});

for (const product of products) {
  const line = lines.get(String(product.lineId));
  const profile = PROFILES.find((p) => p.match.test(line.name)) ?? DEFAULT_PROFILE;
  const name = product.spec?.basicData?.name ?? 'product';
  const count = Math.round(between(...profile.perProduct));
  // products already generated today keep the full range; the others stopped being generated some time ago
  const newest = recentlySynced.has(String(product._id)) ? 0.2 : between(4, 110);
  const oldest = Math.max(newest + 1, HISTORY_DAYS);

  for (let i = 0; i < count; i++) {
    const at = when(newest, Math.max(newest + 1, between(newest + 1, oldest)), now);
    const ago = (now - at.getTime()) / DAY;
    const regression = REGRESSION.match.test(line.name) && ago < REGRESSION.days;
    const roll = random();
    const outcome = roll < (regression ? REGRESSION.error : profile.error(ago))
      ? 'error'
      : roll < (regression ? REGRESSION.error : profile.error(ago)) + profile.warning(ago) ? 'warning' : 'success';
    outcomes[outcome]++;
    deployments++;

    const version = `0.${Math.floor(ago)}.${i}`;
    const base = {
      userId: user._id,
      productId: product._id,
      productName: name,
      lineId: line._id,
      lineName: line.name,
      version,
      at,
    };
    const rows = [
      log(base, 0, 'info', 'log.downloaded_spl'),
      log(base, 900, 'info', 'log.generated_product', [version]),
    ];
    if (outcome === 'error') {
      rows.push(log(base, 1800, 'error', pick([
        "Cannot read properties of undefined (reading 'sensors')",
        'Feature model is not valid: missing mandatory feature',
        'Model "datamodel" does not match its metamodel',
      ])));
    } else {
      rows.push(
        log(base, 1800, 'info', 'log.prettied_code', [version]),
        log(base, 2600, 'info', 'log.created_branch', [`generation/${version}`, 'bigbang']),
        log(base, 3400, 'info', 'log.commited_generation', [`generation/${version}`]),
        log(base, 4200, 'info', 'log.created_merge_request', [`generation/${version}`, 'bigbang']),
      );
      if (outcome === 'warning') {
        rows.push(log(base, 5000, 'warning', 'log.merge_request_conflicts', [`generation/${version}`, 'bigbang']));
      } else {
        rows.push(
          log(base, 5000, 'success', 'log.merged_merge_request', ['bigbang', 'main']),
          log(base, 5600, 'info', 'log.merged_merge_request_deleted', [`generation/${version}`, 'bigbang']),
        );
      }
    }
    for (const row of rows) { delete row.at; documents.push(row); }
  }
}

if (documents.length) await logs.insertMany(documents);
console.log(`${deployments} deployments (${documents.length} logs) over ${products.length} products: ${outcomes.success} ok, ${outcomes.warning} with conflicts, ${outcomes.error} failed`);
await client.close();
