import bcrypt from 'bcrypt';
import { test, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { Container } from 'typedi';
import { ModuleCheckError } from '@lbdudc/linea-core';
import User from '../model/entities/user.js';
import Line from '../model/entities/line.js';
import LineService from '../model/services/LineService.js';
import ProductService from '../model/services/ProductService.js';
import ModularService from '../model/services/modules/ModularService.js';
import MigrationService from '../model/services/MigrationService.js';
import { setup, clear, teardown } from './setup.js';
import { setupGitlabDouble, resetGitlabDouble, teardownGitlabDouble } from './support/withGitlabDouble.js';

// each test makes a line and runs metamodel engines: slower than the default 5s when the whole suite runs in parallel
vi.setConfig({ testTimeout: 90_000 });

const lineService = Container.get(LineService);
const productService = Container.get(ProductService);
const modularService = Container.get(ModularService);
const migrationService = Container.get(MigrationService);

beforeAll(setup);
beforeAll(setupGitlabDouble);
afterEach(clear);
afterEach(resetGitlabDouble);
afterAll(teardown);
afterAll(teardownGitlabDouble);

const admin = async () => new User({
  username: `fm-${Date.now()}-${Math.random()}`,
  password: await bcrypt.hash('password', 10),
  admin: true,
}).save();

// a feature model with a choice (an alternative group), an option, and a rule between them
const MODEL = `featuremodel Shop feature Shop {
  mandatory {
    feature Payment {
      alternative {
        feature Card
        feature Cash
      }
    }
  }
  optional {
    feature Gift
  }
}
constraints {
  Gift => Card
}
`;

const makeLine = async (user, name) => {
  const line = await lineService.createLine({ userId: user._id, name, version: '1.0.0', description: 'x' });
  await modularService.saveLineFeatureModel({ id: line._id, userId: user._id, content: MODEL });
  return line;
};

const makeProduct = (user, line, name, features) => productService.createProduct({
  userId: user._id,
  lineId: line._id,
  spec: { basicData: { name, version: '0.0.0', database: {}, languages: ['en'] }, dataModel: { cells: [] }, features, statics: [] },
});

test('the feature model of a line is a model of the feature metamodel: read as itself and as UVL', async () => {
  const user = await admin();
  const line = await makeLine(user, 'ShopLine');

  const fm = await lineService.getFeatureModel({ id: line._id, userId: user._id });
  expect(fm).toMatchObject({ kind: 'plain', modular: false, readOnly: false, metamodel: 'featuremodel', file: 'models/featuremodel.featuremodel' });
  expect(fm.text).toBe(MODEL);
  // the analysis, the history and the derivation work on UVL
  expect(fm.uvl).toContain('features\n\tShop');
  expect(fm.uvl).toContain('alternative');
  expect(fm.uvl).toContain('Gift => Card');
  // the grammars and scripts that edit it reach the browser
  expect(Object.keys(fm.bundle.grammars)).toEqual(expect.arrayContaining(['featuremodel', 'featureselection']));
});

test('saving the feature model: checked first, committed, and the version is raised when its meaning changed', async () => {
  const user = await admin();
  const line = await makeLine(user, 'SaveLine');
  const afterFirst = (await Line.findById(line._id)).version;
  expect(afterFirst).toBe('1.1.0');

  // a model that does not fit is refused with the diagnostics, and nothing is committed
  await expect(modularService.saveLineFeatureModel({ id: line._id, userId: user._id, content: 'featuremodel Shop feature Shop { mandatory { feature A feature A } }' }))
    .rejects.toBeInstanceOf(ModuleCheckError);
  await expect(modularService.saveLineFeatureModel({ id: line._id, userId: user._id, content: 'this is not a feature model' }))
    .rejects.toBeInstanceOf(ModuleCheckError);
  expect((await Line.findById(line._id)).version).toBe(afterFirst);
  expect((await lineService.getFeatureModel({ id: line._id, userId: user._id })).text).toBe(MODEL);

  // a change of layout does not change what the model says
  const same = await modularService.saveLineFeatureModel({ id: line._id, userId: user._id, content: `// the shop\n${MODEL}` });
  expect(same.bumped).toBe(false);
  expect((await Line.findById(line._id)).version).toBe(afterFirst);

  // a new feature does
  const more = await modularService.saveLineFeatureModel({ id: line._id, userId: user._id, content: MODEL.replace('feature Gift', 'feature Gift\n    feature Invoice'), bump: 'patch' });
  expect(more.bumped).toBe(true);
  expect(more.version).toBe('1.1.1');
  expect(more.uvl).toContain('Invoice');
});

test('a product is healthy when its feature selection fits the feature model, and its features are the selection completed', async () => {
  const user = await admin();
  const line = await makeLine(user, 'HealthLine');
  const product = await makeProduct(user, line, 'Healthy', ['Shop', 'Cash']);

  const health = await productService.getProductHealth({ id: product._id, userId: user._id });
  expect(health).toMatchObject({ valid: true, error: null, errorType: null });
  // what the model implies is added: the root, the parent of Cash, the mandatory Payment
  expect(health.features).toEqual(expect.arrayContaining(['Shop', 'Payment', 'Cash']));
  expect(health.features).not.toContain('Card');
});

test('a feature selection against the rules of the model is reported with its kind, and a rule between features completes it', async () => {
  const user = await admin();
  const line = await makeLine(user, 'RulesLine');

  // two of an alternative group
  const broken = await makeProduct(user, line, 'Broken', ['Card', 'Cash']);
  const health = await productService.getProductHealth({ id: broken._id, userId: user._id });
  expect(health.valid).toBe(false);
  expect(health.errorType).toBe('selection');
  expect(health.error).toMatch(/Payment|choose exactly one/);

  // Gift needs Card (a rule of the model): the selection is completed with it, which also makes the choice of the alternative
  const gift = await makeProduct(user, line, 'Gifted', ['Gift']);
  const giftHealth = await productService.getProductHealth({ id: gift._id, userId: user._id });
  expect(giftHealth.valid).toBe(true);
  expect(giftHealth.features).toEqual(expect.arrayContaining(['Shop', 'Payment', 'Gift', 'Card']));

  // ...but not with the other one: the rule and the alternative cannot both hold
  const clash = await makeProduct(user, line, 'Clash', ['Gift', 'Cash']);
  expect((await productService.getProductHealth({ id: clash._id, userId: user._id })).valid).toBe(false);
});

test('a new feature model of the line is not hidden behind what was found before', async () => {
  const user = await admin();
  const line = await makeLine(user, 'FreshLine');
  const product = await makeProduct(user, line, 'Fresh', ['Shop', 'Cash']);
  expect((await productService.getProductHealth({ id: product._id, userId: user._id })).valid).toBe(true);

  // Cash is gone from the model: the selection of the product does not fit it any more
  await modularService.saveLineFeatureModel({ id: line._id, userId: user._id, content: MODEL.replace('        feature Cash\n', '') });
  const health = await productService.getProductHealth({ id: product._id, userId: user._id });
  expect(health.valid).toBe(false);
});

test('impact analysis: the products of a line checked against its model and against a proposed one', async () => {
  const user = await admin();
  const line = await makeLine(user, 'ImpactLine');
  const fine = await makeProduct(user, line, 'Fine', ['Shop', 'Card']);
  const cash = await makeProduct(user, line, 'Cash', ['Shop', 'Cash']);

  const status = await migrationService.status({ lineId: line._id, userId: user._id });
  expect(status.summary).toEqual({ total: 2, valid: 2, invalid: 0 });

  // the proposed model has no Cash: the product that has it would break
  const proposed = 'features\n\tShop\n\t\tmandatory\n\t\t\tPayment\n\t\t\t\talternative\n\t\t\t\t\tCard\n\t\t\t\t\tInvoice\n\t\toptional\n\t\t\tGift\n';
  const impact = await migrationService.impact({ lineId: line._id, userId: user._id, content: proposed });
  expect(impact.summary).toEqual({ total: 2, breaking: 1, fixing: 0, unaffected: 1 });
  const byId = Object.fromEntries(impact.products.map((p) => [p.productId, p]));
  expect(byId[String(cash._id)]).toMatchObject({ impact: 'breaking', currentStatus: 'valid', proposedStatus: 'invalid' });
  expect(byId[String(cash._id)].reason).toBeTruthy();
  expect(byId[String(fine._id)]).toMatchObject({ impact: 'unaffected_valid' });
});
