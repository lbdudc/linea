import express from 'express';
import { Container } from 'typedi';
import { requireAuth } from '../common/auth.js';
import NotificationController from '../controllers/NotificationController.js';
import { markReadValidator, notificationListValidator, rulesValidator } from '../validators/notificationValidators.js';

const controller = Container.get(NotificationController);
const router = express.Router();

router.get('/', requireAuth, notificationListValidator, controller.list);
router.post('/read', requireAuth, markReadValidator, controller.markRead);
router.get('/rules', requireAuth, controller.getRules);
router.put('/rules', requireAuth, rulesValidator, controller.setRules);
router.delete('/:id', requireAuth, controller.remove);

export default router;
