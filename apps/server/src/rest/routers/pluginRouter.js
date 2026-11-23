import express from 'express';
import { requireAdmin } from '../common/auth.js';
import { asyncHandler } from '../common/asyncHandler.js';
import { pluginHost } from '../../plugins/index.js';
import { exportGitHosts } from '../../model/git/index.js';
import { exportInstance } from '../../config/instanceSettings.js';
import { audited } from '../../model/audit.js';

const pluginRouter = express.Router();

// the catalog with settings schemas and health is the admin's view; everyone else gets `/enabled`
pluginRouter.get('/', requireAdmin, asyncHandler(async (req, res) => res.json(await pluginHost.list())));
// public: the interface needs it before anyone has signed in (the words of the login page can be a plugin's)
pluginRouter.get('/enabled', (req, res) => res.json(pluginHost.enabled()));

const change = (name, action) => [requireAdmin, audited(`plugin.${name}`, { target: (req) => req.params.id }), asyncHandler(async (req, res) => {
  await action(req.params.id);
  // the pages that are open show the plugin's menus and routes: they have to know it changed
  req.app.get('io')?.emit('plugins:changed', { id: req.params.id });
  res.json((await pluginHost.list()).find((plugin) => plugin.id === req.params.id));
})];
pluginRouter.post('/:id/install', ...change('install', (id) => pluginHost.install(id)));
pluginRouter.post('/:id/enable', ...change('enable', (id) => pluginHost.setEnabled(id, true)));
pluginRouter.post('/:id/disable', ...change('disable', (id) => pluginHost.setEnabled(id, false)));
pluginRouter.get('/:id/service/logs', requireAdmin, asyncHandler(async (req, res) => res.json(await pluginHost.serviceLogs(req.params.id, { tail: req.query.tail, service: req.query.service }))));
pluginRouter.post('/:id/service/start', ...change('service.start', (id) => pluginHost.startService(id)));
pluginRouter.post('/:id/service/stop', ...change('service.stop', (id) => pluginHost.stopService(id)));
pluginRouter.delete('/:id', ...change('uninstall', (id) => pluginHost.uninstall(id)));

// what an admin chose, as a linea.config.yml to keep (so the deployment survives a wiped database)
pluginRouter.get('/config.yml', requireAdmin, asyncHandler(async (req, res) => {
  res.type('text/yaml').send(await pluginHost.exportConfig({ gitHosts: exportGitHosts(), instance: exportInstance() }));
}));

// the settings of a plugin (admin only; `settings` is a reserved path, so a plugin cannot serve its own)
pluginRouter.get('/:id/settings', requireAdmin, asyncHandler(async (req, res) => res.json(await pluginHost.getSettings(req.params.id))));
pluginRouter.put('/:id/settings', requireAdmin, audited('plugin.settings', { target: (req) => req.params.id, detail: (req) => ({ keys: Object.keys(req.body ?? {}) }) }), asyncHandler(async (req, res) => res.json(await pluginHost.saveSettings(req.params.id, req.body))));

// is the service of a plugin reachable? (`health` is a reserved path, like `settings`)
pluginRouter.get('/:id/health', requireAdmin, asyncHandler(async (req, res) => res.json(await pluginHost.health(req.params.id))));

// what a plugin serves itself: /api/plugins/<id>/...
pluginRouter.use('/:id', pluginHost.dispatch);

export default pluginRouter;
