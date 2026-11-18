import express from 'express';
import { requireAdmin } from '../common/auth.js';
import { asyncHandler } from '../common/asyncHandler.js';
import { describeGitHosts, saveGitHost, setPrimaryHost } from '../../model/git/index.js';
import { pluginHost } from '../../plugins/index.js';
import { planImport, applyImport, describePlan, rollbackImport } from '../../config/importConfig.js';
import { rememberImport, listImports, findImport } from '../../config/importHistory.js';
import mongoose from 'mongoose';
import { backups } from '../../model/services/BackupService.js';
import User from '../../model/entities/user.js';
import { describeInstance, saveInstance, instance } from '../../config/instanceSettings.js';
import { audited, keysOf, listAudit, record } from '../../model/audit.js';

const settingsRouter = express.Router();

// the git hosts of this deployment: which are on and how each is set (an administrator; what linea.config.yml declares is locked)
settingsRouter.get('/git-hosts', requireAdmin, asyncHandler(async (req, res) => res.json(describeGitHosts())));
// which host is the primary one (the owner of whatever names none)
settingsRouter.put('/git-hosts/primary', requireAdmin, audited('settings.primary-host', { detail: (req) => ({ host: req.body?.host }) }), asyncHandler(async (req, res) => res.json(await setPrimaryHost(req.body?.host))));
settingsRouter.put('/git-hosts/:host', requireAdmin, audited('settings.git-host', { target: (req) => req.params.host, detail: (req) => ({ enabled: req.body?.enabled, keys: keysOf(req.body) }) }), asyncHandler(async (req, res) => res.json(await saveGitHost(req.params.host, req.body))));

// how this LINEA behaves: sign-in, modules, audit (the values are not secrets, so the log keeps them)
settingsRouter.get('/instance', requireAdmin, asyncHandler(async (req, res) => res.json(describeInstance())));
settingsRouter.put('/instance', requireAdmin, audited('settings.instance', { detail: (req) => ({ changes: req.body }) }), asyncHandler(async (req, res) => res.json(await saveInstance(req.body))));

// who changed what, newest first
settingsRouter.get('/audit', requireAdmin, asyncHandler(async (req, res) => res.json(await listAudit(req.query))));

const applier = () => ({
  instance: (patch) => saveInstance(patch),
  gitHost: (kind, patch) => saveGitHost(kind, patch),
  primary: (kind) => setPrimaryHost(kind),
  pluginInstall: (id) => pluginHost.install(id),
  pluginSettings: (id, patch) => pluginHost.saveSettings(id, patch),
  pluginEnabled: (id, enabled) => pluginHost.setEnabled(id, enabled),
});

// a linea.config.yml to bring in: without `apply` it only says what would change; with it, each change is made (and one that fails does not stop the rest)
settingsRouter.post('/import', requireAdmin, asyncHandler(async (req, res) => {
  const plan = await planImport({
    text: String(req.body?.text ?? ''),
    current: {
      instance: async () => describeInstance(),
      gitHosts: async () => describeGitHosts(),
      plugins: () => pluginHost.list(),
      pluginSettings: (id) => pluginHost.getSettings(id),
    },
  }).catch((error) => { throw Object.assign(error, { status: 400, code: 'INSTANCE_SETTINGS' }); });
  if (req.body?.apply !== true) return res.json({ ...describePlan(plan), applied: null });
  const applied = await applyImport(plan, applier());
  record({ userId: req.userId, action: 'settings.import', detail: { applied: applied.filter((r) => r.ok).map((r) => `${r.area}:${r.id}`), failed: applied.filter((r) => !r.ok).map((r) => `${r.area}:${r.id}`) }, ip: req.ip });
  const user = await User.findById(req.userId).select('username').lean();
  await rememberImport({ userId: req.userId, username: user?.username, plan, applied }).catch((error) => console.error('[settings] could not keep the import:', error.message));
  res.json({ ...describePlan(plan), applied });
}));

// backups of the database: the ones kept, one made now, what one holds against what there is, and the file itself
settingsRouter.get('/backups', requireAdmin, asyncHandler(async (req, res) => res.json({ items: await backups.list(), everyHours: instance('backupEveryHours'), keep: instance('backupKeep') })));
settingsRouter.post('/backups', requireAdmin, audited('settings.backup'), asyncHandler(async (req, res) => res.json(await backups.run())));
settingsRouter.get('/backups/:name/preview', requireAdmin, asyncHandler(async (req, res) => {
  const preview = await backups.preview(req.params.name);
  if (!preview) return res.status(404).json({ error: 'error_messages.not_found' });
  res.json(preview);
}));
settingsRouter.get('/backups/:name', requireAdmin, audited('settings.backup-download', { target: (req) => req.params.name }), (req, res) => {
  const file = backups.fileOf(req.params.name);
  if (!file) return res.status(404).json({ error: 'error_messages.not_found' });
  res.download(file);
});

// the last configs that were applied, and putting one back (what it replaced; secrets were never kept)
settingsRouter.get('/import/history', requireAdmin, asyncHandler(async (req, res) => res.json(await listImports())));
settingsRouter.post('/import/:id/rollback', requireAdmin, asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'error_messages.not_found' });
  const entry = await findImport(req.params.id);
  if (!entry) return res.status(404).json({ error: 'error_messages.not_found' });
  if (entry.rolledBackAt) return res.status(409).json({ error: 'error_messages.internal_error', detail: 'already rolled back' });
  const results = await rollbackImport(entry.before, applier());
  entry.rolledBackAt = new Date();
  await entry.save();
  record({ userId: req.userId, action: 'settings.import-rollback', target: String(entry._id), detail: { restored: results.filter((r) => r.ok).map((r) => `${r.area}:${r.id}`), failed: results.filter((r) => !r.ok).map((r) => `${r.area}:${r.id}`) }, ip: req.ip });
  res.json({ results });
}));

export default settingsRouter;
