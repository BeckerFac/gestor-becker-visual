import { Router } from 'express';
import { apiKeysController } from './apikeys.controller';
import { requireRole } from '../../middlewares/authorize';

export const apiKeysRouter = Router();

// Only owner and admin can manage API keys
apiKeysRouter.post('/', requireRole('owner', 'admin'), (req, res) => apiKeysController.create(req as any, res));
apiKeysRouter.get('/', requireRole('owner', 'admin'), (req, res) => apiKeysController.list(req as any, res));
apiKeysRouter.post('/:id/revoke', requireRole('owner', 'admin'), (req, res) => apiKeysController.revoke(req as any, res));
