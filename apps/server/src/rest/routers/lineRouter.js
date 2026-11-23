import express from 'express';
import issueRouter from './issueRouter.js';
import mergeRequestRouter from './mergeRequestRouter.js';
import repositoryRouter from './repositoryRouter.js';
import { requireAuth } from '../common/auth.js';
import { Container } from 'typedi';
import ReleaseController from '../controllers/ReleaseController.js';
import { changelogRangeValidator } from '../validators/changelogValidators.js';
import ChangelogController from '../controllers/ChangelogController.js';
import { restoreValidator, deleteLineValidator, createLineValidator, memberParamValidator, memberValidator, hostQueryValidator, fromUvlValidator, saveFeatureModelValidator, tryDerivationValidator, trialModelsValidator, checkTrialModelsValidator } from '../validators/lineValidators.js';
import LineController from '../controllers/LineController.js';
import AccessController from '../controllers/AccessController.js';
import { accessValidator, accessParamValidator } from '../validators/accessValidators.js';
import { modulesControllers as modules } from './packageRouter.js';
import { saveLineModulesValidator, checkLineModulesValidator } from '../validators/packageValidators.js';
import { productVersionValidator as lineVersionValidator, lineSyncValidator } from '../validators/productValidators.js';
import AutomationController from '../controllers/AutomationController.js';

const lineRouter = express.Router();
const lineController = Container.get(LineController);
const automation = Container.get(AutomationController);

lineRouter.post('/', requireAuth, createLineValidator, lineController.createLine);
lineRouter.get('/enrolled', requireAuth, lineController.findEnrolledLines);
lineRouter.get('/inactive', requireAuth, lineController.findInactiveLines);
lineRouter.get('/deletable', requireAuth, lineController.getLinesDeletable);
// Must stay above '/:id' — otherwise Express matches it as a line id.
lineRouter.get('/namespaces', requireAuth, hostQueryValidator, lineController.findAvailableNamespaces);
lineRouter.post('/reconcile', requireAuth, lineController.reconcileLines);
lineRouter.post('/restore', requireAuth, restoreValidator, lineController.restoreLine);

// What a line is made of, and the check of a line that does not exist yet.
lineRouter.post('/modules/preview', requireAuth, checkLineModulesValidator(), modules.lineModules.preview);
lineRouter.post('/metamodels/preview', requireAuth, modules.lineModules.preview);

lineRouter.get('/:id', requireAuth, lineController.findLineById);
lineRouter.delete('/:id', requireAuth, deleteLineValidator, lineController.deleteLine);
lineRouter.get('/:id/modules', requireAuth, modules.lineModules.get);
lineRouter.put('/:id/modules', requireAuth, saveLineModulesValidator(), modules.lineModules.save);
lineRouter.post('/:id/modules/check', requireAuth, checkLineModulesValidator(), modules.lineModules.check);
// what the products of the line inherit for syncing, the syncs of all of them and their merge requests
lineRouter.get('/:id/sync', requireAuth, automation.getLineSync);
lineRouter.put('/:id/sync', requireAuth, lineSyncValidator, automation.saveLineSync);
lineRouter.get('/:id/ci', requireAuth, automation.getLineCi);
lineRouter.put('/:id/ci', requireAuth, automation.saveLineCi);
lineRouter.get('/:id/syncs', requireAuth, automation.listLineSyncs);
lineRouter.get('/:id/merge-requests', requireAuth, automation.listLineMergeRequests);
lineRouter.get('/:id/products', requireAuth, lineController.listProducts);
lineRouter.use('/:id/issues', issueRouter('line'));
lineRouter.use('/:id/mrs', mergeRequestRouter('line'));
lineRouter.use('/:id/repo', repositoryRouter('line'));
lineRouter.get('/:id/members', requireAuth, lineController.listMembers);
lineRouter.put('/:id/members/:username', requireAuth, memberValidator, lineController.setMember);
lineRouter.delete('/:id/members/:username', requireAuth, memberParamValidator, lineController.removeMember);
// who reaches the repositories of the line and of its products on the git host, and what LINEA writes there
const access = Container.get(AccessController);
lineRouter.get('/:id/access', requireAuth, access.line);
lineRouter.get('/:id/access/users', requireAuth, access.users);
lineRouter.post('/:id/access/reapply', requireAuth, access.reapplyLine);
lineRouter.put('/:id/access/:username', requireAuth, accessValidator, access.setLine);
lineRouter.delete('/:id/access/:username', requireAuth, accessParamValidator, access.removeLine);
lineRouter.get('/:id/versions', requireAuth, lineController.listVersions);
lineRouter.get('/:id/versions/:version', requireAuth, lineVersionValidator, lineController.getVersion);
// the release of each version (the changelog kept, the failure to retry) and the backfill of the tags that have none
const lineReleases = Container.get(ReleaseController).for('line');
lineRouter.get('/:id/changelog', requireAuth, changelogRangeValidator, Container.get(ChangelogController).line);
lineRouter.get('/:id/releases', requireAuth, lineReleases.list);
lineRouter.post('/:id/releases', requireAuth, lineReleases.backfill);
lineRouter.get('/:id/releases/:version', requireAuth, lineVersionValidator, lineReleases.get);
lineRouter.post('/:id/releases/:version/retry', requireAuth, lineVersionValidator, lineReleases.retry);
lineRouter.get('/:id/model', requireAuth, lineController.getFeatureModel);
lineRouter.post('/:id/model/preview', requireAuth, lineController.previewFeatureModel);
lineRouter.post('/:id/model/from-uvl', requireAuth, fromUvlValidator, lineController.featureModelFromUvl);
lineRouter.put('/:id/model', requireAuth, saveFeatureModelValidator, lineController.saveFeatureModel);
lineRouter.post('/:id/derive-trial', requireAuth, tryDerivationValidator, lineController.tryDerivation);
lineRouter.get('/:id/trial-models', requireAuth, trialModelsValidator, lineController.getTrialModels);
lineRouter.post('/:id/trial-models/check', requireAuth, checkTrialModelsValidator, lineController.checkTrialModels);

export default lineRouter;