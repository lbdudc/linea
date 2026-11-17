import { Container } from 'typedi';
import LineService from './LineService.js';
import ModularService from './modules/ModularService.js';
import { timed } from '../../rest/common/serverTiming.js';

// the features a product has: its feature selection's, once completed (the index of the product keeps them)
const featuresOf = (product) => (Array.isArray(product.spec?.features) ? product.spec.features : []);

const check = (verdict) => (verdict.valid
  ? { status: 'valid', reason: null }
  : { status: 'invalid', reason: verdict.problems[0] ?? null });

/**
 * What a feature model means for the products of a line, from the feature metamodel alone: which products are valid against the
 * model, and which would break (or be fixed) by a proposed one. Nothing here asks a model for an opinion.
 */
export default class MigrationService {
  lineService = Container.get(LineService);
  modularService = Container.get(ModularService);

  // every product of the line checked against its current feature model
  status = async ({ lineId, userId }) => {
    await this.lineService.findLineById({ id: lineId, userId });
    const products = await timed('products', () => this.lineService.findProductsByLineId({ id: lineId, userId, specFromRepo: true }));
    const selections = products.map(featuresOf);
    const verdicts = (await timed('selections', () => this.modularService.checkSelections({ id: lineId, userId, selections }))).map((verdict, index) => {
      const product = products[index];
      const { status, reason } = check(verdict);
      return {
        productId: String(product._id),
        name: product.spec?.basicData?.name ?? String(product._id),
        version: product.spec?.basicData?.version ?? '?',
        status,
        reason,
        errorType: status === 'valid' ? null : 'selection',
        features: selections[index],
      };
    });

    const invalid = verdicts.filter((v) => v.status === 'invalid').length;
    return {
      summary: { total: verdicts.length, valid: verdicts.length - invalid, invalid },
      products: verdicts,
    };
  };

  // every product of the line checked against its current model and against a proposed one
  // `content`: the proposed feature model, as UVL; `modules`, for a line made of modules: the model they would compose stands for it
  impact = async ({ lineId, userId, content, modules, metamodels }) => {
    await this.lineService.findLineById({ id: lineId, userId });
    const proposedUvl = modules || metamodels
      ? await this.modularService.proposedFeatureModel({ id: lineId, userId, modules, metamodels })
      : content;
    const products = await this.lineService.findProductsByLineId({ id: lineId, userId, specFromRepo: true });
    const selections = products.map(featuresOf);
    const [currentVerdicts, proposedVerdicts, currentMandatory, proposedMandatory] = await Promise.all([
      this.modularService.checkSelections({ id: lineId, userId, selections }),
      this.modularService.checkSelections({ id: lineId, userId, uvl: proposedUvl, selections }),
      this.modularService.mandatoryFeatures({ id: lineId, userId }),
      this.modularService.mandatoryFeatures({ id: lineId, userId, uvl: proposedUvl }),
    ]);

    const verdicts = products.map((product, index) => {
      const current = check(currentVerdicts[index]);
      const proposed = check(proposedVerdicts[index]);

      // a feature the proposed model makes mandatory that the product does not have yet: the sync brings it in
      const added = proposed.status === 'valid'
        ? proposedMandatory.filter((feature) => !currentMandatory.includes(feature) && !selections[index].includes(feature))
        : [];

      let impact;
      if (current.status === 'valid' && proposed.status === 'invalid') impact = 'breaking';
      else if (current.status === 'invalid' && proposed.status === 'valid') impact = 'fixing';
      else if (added.length) impact = 'fixing';
      else if (current.status === 'valid') impact = 'unaffected_valid';
      else impact = 'unaffected_invalid';

      return {
        productId: String(product._id),
        name: product.spec?.basicData?.name ?? String(product._id),
        version: product.spec?.basicData?.version ?? '?',
        impact,
        currentStatus: current.status,
        proposedStatus: proposed.status,
        reason: proposed.reason,
        errorType: proposed.status === 'valid' ? null : 'selection',
        features: selections[index],
        added,
      };
    });

    const breaking = verdicts.filter((v) => v.impact === 'breaking').length;
    const fixing = verdicts.filter((v) => v.impact === 'fixing').length;
    return {
      summary: { total: verdicts.length, breaking, fixing, unaffected: verdicts.length - breaking - fixing },
      products: verdicts,
    };
  };
}

Container.set(MigrationService, new MigrationService());
