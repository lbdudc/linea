import { Container } from 'typedi';
import ProductService from '../ProductService.js';
import UserService from '../UserService.js';
import SyncScheduler from './SyncScheduler.js';
import CicdAlertService from '../CicdAlertService.js';
import { backups } from '../BackupService.js';

let scheduler = null;

/** The one scheduler of this server (made on first use, so reading its status does not start it). */
// Nobody is signed in when a schedule fires, and the git host token of the owner lasts a couple of hours: it is renewed first
// (a refresh token that no longer works fails the run, with the reason in it).
export const syncAsOwner = ({ renew, sync }) => async (args) => {
  await renew({ userId: args.userId });
  return sync(args);
};

export const syncScheduler = () => (scheduler ??= new SyncScheduler({
  sync: syncAsOwner({
    renew: (args) => Container.get(UserService).loginUserFromId(args),
    sync: (args) => Container.get(ProductService).syncProduct(args),
  }),
}));

/** Starts it, unless the deployment says not to (`LINEA_SCHEDULER=off`; tests never start it). */
export const startScheduler = () => {
  if (process.env.LINEA_SCHEDULER === 'off' || process.env.VITEST) return null;
  syncScheduler().start();
  Container.get(CicdAlertService).start();
  backups.start();
  return syncScheduler();
};
