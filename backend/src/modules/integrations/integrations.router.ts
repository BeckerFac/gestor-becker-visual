import { Router } from 'express';
import { integrationsController } from './integrations.controller';
import { authorize } from '../../middlewares/authorize';

export const integrationsRouter = Router();

integrationsRouter.get('/', authorize('settings', 'view'), (req, res) => integrationsController.list(req as any, res));
integrationsRouter.get('/:id', authorize('settings', 'view'), (req, res) => integrationsController.get(req as any, res));
integrationsRouter.post('/', authorize('settings', 'edit'), (req, res) => integrationsController.create(req as any, res));
integrationsRouter.put('/:id', authorize('settings', 'edit'), (req, res) => integrationsController.update(req as any, res));
integrationsRouter.delete('/:id', authorize('settings', 'edit'), (req, res) => integrationsController.delete(req as any, res));
integrationsRouter.get('/:id/sync-log', authorize('settings', 'view'), (req, res) => integrationsController.syncLog(req as any, res));
