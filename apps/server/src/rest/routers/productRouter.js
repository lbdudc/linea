import express from 'express';
import issueRouter from './issueRouter.js';
import mergeRequestRouter from './mergeRequestRouter.js';
import repositoryRouter from './repositoryRouter.js';
import { requireAuth } from '../common/auth.js';
import { Container } from 'typedi';
import ReleaseController from '../controllers/ReleaseController.js';
import { changelogRangeValidator } from '../validators/changelogValidators.js';
import ChangelogController from '../controllers/ChangelogController.js';
import { createProductValidator, updateProductValidator, renameProductValidator, generateProductValidator, discardSavedValidator, productVersionValidator, generateZipValidator, productCiRunnersValidator, productMergeRequestValidator, productUpdateDecisionValidator, productJobValidator, productAutomationValidator } from '../validators/productValidators.js';
import ProductController from '../controllers/ProductController.js';
import AutomationController from '../controllers/AutomationController.js';
import { hostQueryValidator, restoreValidator } from '../validators/lineValidators.js';
import { saveProductSelectionValidator, saveProductModelValidator, saveProductLayoutsValidator, checkProductModelsValidator } from '../validators/productModelValidators.js';

const productRouter = express.Router();
const productController = Container.get(ProductController);
const automation = Container.get(AutomationController);

productRouter.post('/', requireAuth, createProductValidator, productController.createProduct);
productRouter.get('/generation/settings', requireAuth, productController.getGenerationSettings);
productRouter.get('/enrolled', requireAuth, productController.findEnrolledProducts);
productRouter.get('/inactive', requireAuth, productController.findInactiveProducts);
productRouter.post('/reconcile', requireAuth, productController.reconcileProducts);
productRouter.post('/restore', requireAuth, restoreValidator, productController.restoreProduct);
// Must stay above '/:id'.
// project ids are only unique on a host: `?host=` says which one (the primary host without it)
productRouter.get('/by-git-project/:projectId', requireAuth, hostQueryValidator, productController.findByGitProject);
productRouter.get('/status', requireAuth, productController.getProductsStatus);
productRouter.get('/summary', requireAuth, productController.getProductsSummary);
productRouter.get('/deletable', requireAuth, productController.getProductsDeletable);
productRouter.get('/pipelines', requireAuth, productController.getProductsPipelines);
productRouter.get('/deployments', requireAuth, productController.getProductsDeployments);
// Must stay above '/:id'.
productRouter.get('/version-pipelines', requireAuth, productController.getProductsVersionPipelines);
productRouter.get('/:id', requireAuth, productController.findProductById);
productRouter.get('/:id/models', requireAuth, productController.getModels);
productRouter.put('/:id/models/:metamodel', requireAuth, saveProductModelValidator, productController.saveModel);
// the selection as feature names; the model text is made on the server
productRouter.put('/:id/selection', requireAuth, saveProductSelectionValidator, productController.saveSelection);
productRouter.put('/:id/layouts', requireAuth, saveProductLayoutsValidator, productController.saveLayouts);
productRouter.post('/:id/models/check', requireAuth, checkProductModelsValidator, productController.checkModels);
productRouter.post('/:id/models/sync', requireAuth, productController.syncModels);
productRouter.get('/:id/activity', requireAuth, productController.getProductActivity);
productRouter.get('/:id/health', requireAuth, productController.getProductHealth);
productRouter.get('/:id/pipeline', requireAuth, productController.getProductPipeline);
productRouter.get('/:id/pipelines/by-version', requireAuth, productController.getVersionPipelines);
productRouter.get('/:id/pipelines/:pipelineId', requireAuth, productController.getProductPipelineById);
productRouter.post('/:id/pipeline/retry', requireAuth, productController.retryProductPipeline);
productRouter.post('/:id/pipelines/:pipelineId/cancel', requireAuth, productController.cancelProductPipeline);
productRouter.post('/:id/jobs/:jobId/cancel', requireAuth, productController.cancelProductJob);
productRouter.get('/:id/ci', requireAuth, productController.getProductCi);
productRouter.put('/:id/ci', requireAuth, productController.saveProductCi);
productRouter.put('/:id/ci/runners', requireAuth, productCiRunnersValidator, productController.setProductCiRunners);
productRouter.use('/:id/issues', issueRouter('product'));
productRouter.use('/:id/mrs', mergeRequestRouter('product'));
productRouter.use('/:id/repo', repositoryRouter('product'));
productRouter.get('/:id/merge-requests', requireAuth, productController.listProductMergeRequests);
// Must stay above '/:id/merge-requests/:number'.
productRouter.get('/:id/merge-requests/latest', requireAuth, productController.getLatestProductMergeRequest);
productRouter.get('/:id/jobs/:jobId/trace', requireAuth, productJobValidator, productController.getProductJobTrace);
productRouter.post('/:id/merge-requests/:number/decision', requireAuth, productUpdateDecisionValidator, productController.decideProductUpdate);
productRouter.get('/:id/merge-requests/:number', requireAuth, productMergeRequestValidator, productController.getProductMergeRequest);
productRouter.get('/:id/deployment', requireAuth, productController.getProductDeployment);
productRouter.get('/:id/conflicts', requireAuth, productController.getConflicts);
productRouter.post('/:id/conflicts/:number/resolve', requireAuth, productController.resolveConflicts);
productRouter.post('/:id/discard', requireAuth, discardSavedValidator, productController.discardSavedSpec);
productRouter.get('/:id/versions', requireAuth, productController.listProductVersions);
productRouter.get('/:id/versions/:version', requireAuth, productVersionValidator, productController.getProductVersion);
// the release of each version (the changelog kept, the failure to retry) and the backfill of the tags that have none
const productReleases = Container.get(ReleaseController).for('product');
productRouter.get('/:id/changelog', requireAuth, changelogRangeValidator, Container.get(ChangelogController).product);
productRouter.get('/:id/releases', requireAuth, productReleases.list);
productRouter.post('/:id/releases', requireAuth, productReleases.backfill);
productRouter.get('/:id/releases/:version', requireAuth, productVersionValidator, productReleases.get);
productRouter.post('/:id/releases/:version/retry', requireAuth, productVersionValidator, productReleases.retry);
productRouter.get('/:id/versions/:version/bundle', requireAuth, productVersionValidator, productController.downloadGenerationBundle);
productRouter.get('/:id/versions/:version/zip', requireAuth, productVersionValidator, productController.downloadVersionZip);
productRouter.post('/:id/versions/:version/restore', requireAuth, productVersionValidator, discardSavedValidator, productController.restoreVersion);
productRouter.get('/:id/conflicts', requireAuth, productController.getProductConflicts);
productRouter.delete('/:id', requireAuth, productController.deleteProduct);
productRouter.patch('/:id', requireAuth, updateProductValidator, productController.updateProduct);
productRouter.post('/:id/rename', requireAuth, renameProductValidator, productController.renameProduct);
productRouter.post('/:id/generate', requireAuth, generateProductValidator, productController.generateProduct);
// a sync puts the code back in line with the SPL without raising the version; a generation applies the edited spec and does
productRouter.post('/:id/sync', requireAuth, automation.syncProduct);
productRouter.get('/:id/syncs', requireAuth, automation.listProductSyncs);
productRouter.get('/:id/automation', requireAuth, automation.getProductAutomation);
productRouter.put('/:id/automation', requireAuth, productAutomationValidator, automation.saveProductAutomation);
productRouter.post('/:id/generate/cancel', requireAuth, productController.cancelGeneration);
productRouter.post('/:id/preview', requireAuth, generateProductValidator, productController.previewGeneration);
productRouter.post('/:id/zip', requireAuth, generateZipValidator, productController.generateZip);

export default productRouter;