import express from 'express';
import { Container } from 'typedi';
import { requireAuth } from '../common/auth.js';
import NotificationController from '../controllers/NotificationController.js';
import { createNotificationValidator, markReadValidator, notificationListValidator, rulesValidator } from '../validators/notificationValidators.js';

const controller = Container.get(NotificationController);
const router = express.Router();

router.get('/', requireAuth, notificationListValidator, controller.list);
// something waits for the person on an issue or a merge request (a plugin acting for them says it: only to themselves)
router.post('/', requireAuth, createNotificationValidator, controller.create);
router.post('/read', requireAuth, markReadValidator, controller.markRead);
router.get('/rules', requireAuth, controller.getRules);
router.put('/rules', requireAuth, rulesValidator, controller.setRules);
router.delete('/:id', requireAuth, controller.remove);

export default router;
