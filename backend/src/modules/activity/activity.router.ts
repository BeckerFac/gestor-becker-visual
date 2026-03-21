import { Router } from 'express';
import { activityController } from './activity.controller';
import { authMiddleware } from '../../middlewares/auth';
import { requireMinRole } from '../../middlewares/authorize';

const router = Router();

router.use(authMiddleware);
router.use(requireMinRole('admin'));

router.get('/logs', (req, res) => activityController.getLogs(req as any, res));

export { router as activityRouter };
