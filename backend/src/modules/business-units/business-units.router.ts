import { Router } from 'express';
import { businessUnitsController } from './business-units.controller';
import { authorize } from '../../middlewares/authorize';

export const businessUnitsRouter = Router();

businessUnitsRouter.get('/', authorize('settings', 'view'), (req, res) => businessUnitsController.getAll(req as any, res));
businessUnitsRouter.get('/default', authorize('settings', 'view'), (req, res) => businessUnitsController.getDefault(req as any, res));
businessUnitsRouter.get('/:id', authorize('settings', 'view'), (req, res) => businessUnitsController.getOne(req as any, res));
businessUnitsRouter.post('/', authorize('settings', 'create'), (req, res) => businessUnitsController.create(req as any, res));
businessUnitsRouter.patch('/:id', authorize('settings', 'edit'), (req, res) => businessUnitsController.update(req as any, res));
businessUnitsRouter.delete('/:id', authorize('settings', 'delete'), (req, res) => businessUnitsController.remove(req as any, res));
