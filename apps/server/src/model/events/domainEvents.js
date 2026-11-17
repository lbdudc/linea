import { EventEmitter } from 'node:events';

/**
 * Neutral in-process domain event bus. The model/services layer emits domain
 * events here; subscribers (see domainEventBridge.js for the outbound webhook) listen.
 * The services know nothing about who listens: with no subscriber these emits are no-ops.
 */
const domainEvents = new EventEmitter();
domainEvents.setMaxListeners(50);

export const DOMAIN_EVENTS = {
  PRODUCT_GENERATED: 'product:generated',
  // the feature model of a line was committed: what its products were found to be (valid or not) is no longer known
  LINE_MODEL_CHANGED: 'line:model-changed',
  // somebody pushed to a repository of the local git host (the other hosts tell LINEA through their webhooks): `{ host, repositoryId, repositoryPath, username }`
  GIT_PUSHED: 'git:pushed',
  ISSUE_CREATED: 'issue:created',
  ISSUE_UPDATED: 'issue:updated',
  ISSUE_COMMENTED: 'issue:commented',
  MR_CREATED: 'mr:created',
  MR_UPDATED: 'mr:updated',
  MR_COMMENTED: 'mr:commented',
};

export default domainEvents;
