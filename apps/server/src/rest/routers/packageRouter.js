import express from 'express';
import { requireAuth, requireAdminIf } from '../common/auth.js';
import { audited } from '../../model/audit.js';
import { createControllers } from '../controllers/ModulesController.js';
import { Container } from 'typedi';
import { changelogRangeValidator } from '../validators/changelogValidators.js';
import ChangelogController from '../controllers/ChangelogController.js';
import * as v from '../validators/packageValidators.js';
import repositoryRouter from './repositoryRouter.js';

const c = createControllers();

/** The packages (modules and metamodels) of the registry: `/api/packages`. */
export const packageRouter = express.Router();
packageRouter.get('/:kind', requireAuth, ...v.listPackagesValidator(), c.package.list);
packageRouter.post('/:kind', requireAuth, ...v.createPackageValidator(), c.package.create);
packageRouter.get('/:kind/changelog', requireAuth, ...v.listPackagesValidator(), changelogRangeValidator, Container.get(ChangelogController).packageByLocation);
packageRouter.get('/:kind/:id', requireAuth, ...v.packageValidator(), c.package.get);
packageRouter.get('/:kind/:id/file', requireAuth, ...v.readPackageFileValidator(), c.package.readFile);
packageRouter.put('/:kind/:id/file', requireAuth, ...v.savePackageFileValidator(), c.package.saveFile);
packageRouter.put('/:kind/:id/files', requireAuth, ...v.savePackageFilesValidator(), c.package.saveFiles);
packageRouter.get('/:kind/:id/changelog', requireAuth, changelogRangeValidator, ...v.packageValidator(), Container.get(ChangelogController).package);
packageRouter.get('/:kind/:id/usage', requireAuth, ...v.packageValidator(), c.package.usage);
packageRouter.get('/:kind/:id/studio', requireAuth, ...v.packageValidator(), c.package.studio);
packageRouter.post('/:kind/:id/trial', requireAuth, ...v.packageTrialValidator(), c.package.trial);
packageRouter.post('/:kind/:id/derive-trial', requireAuth, ...v.packageDeriveTrialValidator(), c.package.deriveTrial);
packageRouter.post('/:kind/:id/check-trial', requireAuth, ...v.packageCheckTrialValidator(), c.package.checkTrial);
packageRouter.use('/:kind/:id/repo', requireAuth, ...v.packageValidator(), repositoryRouter('package'));
packageRouter.delete('/:kind/:id/file', requireAuth, ...v.deletePackageFileValidator(), c.package.deleteFile);
packageRouter.post('/:kind/:id/check', requireAuth, ...v.packageValidator(), c.package.check);
packageRouter.post('/:kind/:id/publish', requireAuth, requireAdminIf('modulesPublish'), audited('modules.publish', { target: (req) => `${req.params.kind}/${req.params.id}` }), ...v.publishPackageValidator(), c.package.publish);

/** Which packages this LINEA lists: `/api/registry`. */
export const registryRouter = express.Router();
registryRouter.get('/status', requireAuth, c.registry.status);
registryRouter.get('/', requireAuth, ...v.listRegistryValidator(), c.registry.entries);
registryRouter.get('/suggestions', requireAuth, ...v.listRegistryValidator(), c.registry.suggestions);
registryRouter.post('/', requireAuth, requireAdminIf('modulesRegister'), audited('modules.register', { target: (req) => req.body?.location }), ...v.registerPackageValidator(), c.registry.register);
registryRouter.delete('/', requireAuth, requireAdminIf('modulesRegister'), audited('modules.unregister', { target: (req) => req.query?.location }), ...v.unregisterPackageValidator(), c.registry.unregister);

export { c as modulesControllers };
