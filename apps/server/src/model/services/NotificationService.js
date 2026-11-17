import { Container } from 'typedi';
import mongoose from 'mongoose';
import Notification from '../entities/notification.js';
import UserRepository from '../repositories/UserRepository.js';
import domainEvents, { DOMAIN_EVENTS } from '../events/domainEvents.js';
import { primaryHost } from '../git/index.js';

const MENTION = /(?:^|[^\w@.])@([A-Za-z0-9][A-Za-z0-9_.-]{0,99})/g;
const EXCERPT_LENGTH = 160;
const PAGE_SIZE = 30;

const SUBJECT_OF = {
  [DOMAIN_EVENTS.ISSUE_CREATED]: 'issue',
  [DOMAIN_EVENTS.ISSUE_UPDATED]: 'issue',
  [DOMAIN_EVENTS.ISSUE_COMMENTED]: 'issue',
  [DOMAIN_EVENTS.MR_CREATED]: 'mr',
  [DOMAIN_EVENTS.MR_UPDATED]: 'mr',
  [DOMAIN_EVENTS.MR_COMMENTED]: 'mr',
};

const COMMENT_EVENTS = new Set([DOMAIN_EVENTS.ISSUE_COMMENTED, DOMAIN_EVENTS.MR_COMMENTED]);
const CREATE_EVENTS = new Set([DOMAIN_EVENTS.ISSUE_CREATED, DOMAIN_EVENTS.MR_CREATED]);

const REASON_PRIORITY = ['assigned', 'mentioned', 'state', 'comment'];

export const mentionsIn = (text) => [...new Set([...(text ?? '').matchAll(MENTION)].map((match) => match[1]))];

const excerptOf = (text) => {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat;
};

export default class NotificationService {
  users = Container.get(UserRepository);

  #accountsOf = async (host, names) => {
    const found = new Map();
    for (const name of new Set(names.filter(Boolean))) {
      const user = await this.users.findByHostAccount({ host, hostUsername: name, primary: primaryHost() });
      if (user && !user.disabled) found.set(name, user);
    }
    return found;
  };

  /** Who is told about an event, and why: the people named in it that have an account here, each once, for the strongest reason. */
  recipientsOf = (event, payload) => {
    const reasons = new Map();
    const add = (name, reason) => {
      if (!name || name === payload.actor?.username) return;
      const current = reasons.get(name);
      if (!current || REASON_PRIORITY.indexOf(reason) < REASON_PRIORITY.indexOf(current)) reasons.set(name, reason);
    };
    const previous = new Set(payload.previousAssignees ?? payload.assignees ?? []);
    for (const name of payload.assignees ?? []) if (!previous.has(name)) add(name, 'assigned');
    for (const name of mentionsIn(payload.text)) add(name, 'mentioned');
    const followers = [payload.author, ...(payload.assignees ?? [])];
    if (payload.previousState && payload.state && payload.previousState !== payload.state) for (const name of followers) add(name, 'state');
    if (COMMENT_EVENTS.has(event)) for (const name of [...followers, ...(payload.commenters ?? [])]) add(name, 'comment');
    return reasons;
  };

  notify = async (event, payload) => {
    const subject = SUBJECT_OF[event];
    if (!subject || !payload?.target) return [];
    const reasons = this.recipientsOf(event, payload);
    if (!reasons.size) return [];
    const accounts = await this.#accountsOf(payload.host, [...reasons.keys()]);
    const created = [];
    for (const [name, reason] of reasons) {
      const user = accounts.get(name);
      if (!user) continue;
      created.push({
        userId: user._id,
        reason,
        subject,
        target: payload.target,
        number: payload.number,
        title: payload.title,
        actor: payload.actor?.username,
        excerpt: excerptOf(COMMENT_EVENTS.has(event) || CREATE_EVENTS.has(event) || reason === 'mentioned' ? payload.text : ''),
        state: payload.state,
      });
    }
    return created.length ? Notification.insertMany(created) : [];
  };

  list = async ({ userId, unread = false, page = 1 }) => {
    const filter = { userId, ...(unread ? { read: false } : {}) };
    const items = await Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE + 1).lean();
    return {
      items: items.slice(0, PAGE_SIZE).map((item) => ({ ...item, id: String(item._id), _id: undefined, userId: undefined, __v: undefined })),
      page,
      hasMore: items.length > PAGE_SIZE,
      unread: await this.unreadCount({ userId }),
    };
  };

  unreadCount = ({ userId }) => Notification.countDocuments({ userId, read: false });

  markRead = async ({ userId, ids }) => {
    const valid = (ids ?? []).filter((id) => mongoose.isValidObjectId(id));
    const filter = { userId, read: false, ...(ids ? { _id: { $in: valid } } : {}) };
    await Notification.updateMany(filter, { $set: { read: true } });
    return { unread: await this.unreadCount({ userId }) };
  };

  remove = async ({ userId, id }) => {
    if (mongoose.isValidObjectId(id)) await Notification.deleteOne({ _id: id, userId });
    return { unread: await this.unreadCount({ userId }) };
  };
}

Container.set(NotificationService, new NotificationService());

let wired = false;

export const wireNotifications = () => {
  if (wired) return;
  wired = true;
  const service = Container.get(NotificationService);
  for (const event of Object.keys(SUBJECT_OF)) {
    domainEvents.on(event, (payload) => {
      service.notify(event, payload).catch((error) => console.error(`[notifications] ${event}:`, error?.message ?? error));
    });
  }
};
