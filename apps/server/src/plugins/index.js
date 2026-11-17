import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { Container } from 'typedi';
import domainEvents from '../model/events/domainEvents.js';
import { mongoPluginStore } from '../model/entities/plugin.js';
import { addServiceKeys, requireAuth, requireAdmin } from '../rest/common/auth.js';
import { enabledHosts } from '../model/git/index.js';
import { asyncHandler } from '../rest/common/asyncHandler.js';
import { rateLimit } from '../rest/common/rateLimit.js';
import handleValidationErrors from '../rest/validators/commonValidationHandler.js';
import * as errors from '../model/errors/errors.js';
import UserRepository from '../model/repositories/UserRepository.js';
import { PluginHost } from './PluginHost.js';
import { loadDeployConfig } from '../config/deployConfig.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(here, '../../package.json'), 'utf8'));

/** The plugins folder of this deployment: `PLUGINS_DIR`, or a `linea-plugins` checkout next to this one. */
export const pluginsDir = () => process.env.PLUGINS_DIR || path.resolve(here, '../../../../../linea-plugins');

/** What a plugin may use of the server (`ctx.services`): listed here and nowhere else. */
export const services = {
  requireAuth, requireAdmin, asyncHandler, rateLimit, handleValidationErrors, errors,
  get userRepository() { return Container.get(UserRepository); },
};

/**
 * What the deployment says in `linea.config.yml` (`LINEA_CONFIG`, else `/config/linea.config.yml` where Docker mounts it, else
 * `linea/linea.config.yml`): plugins to have on, with their settings.
 * Without the file everything is as before: plugins are what people chose in the Plugins view (and `LINEA_PLUGINS`).
 */
const CONTAINER_CONFIG = '/config/linea.config.yml';
const LOCAL_CONFIG = path.resolve(here, '../../../../linea.config.yml');
export const deployConfig = loadDeployConfig({
  file: process.env.LINEA_CONFIG || [CONTAINER_CONFIG, LOCAL_CONFIG].find((candidate) => existsSync(candidate)) || LOCAL_CONFIG,
  required: Boolean(process.env.LINEA_CONFIG),
});
for (const warning of deployConfig.warnings) console.warn(`[config] ${warning}`);

/** What to provision at start: the plugins in `LINEA_PLUGINS` that nobody has decided about yet. */
export const provisionList = (env = process.env) => (env.LINEA_PLUGINS ?? '').split(',').map((id) => id.trim()).filter(Boolean);

/** The host of this server. */
export const pluginHost = new PluginHost({
  pluginsDir: pluginsDir(),
  lineaVersion: version,
  store: mongoPluginStore,
  events: domainEvents,
  services,
  declared: deployConfig.declared,
  enabledHosts,
});
// the keys the plugins have for their services count with those of LINEA_SERVICE_KEYS: one place to rotate them
addServiceKeys(() => pluginHost.serviceKeys());
