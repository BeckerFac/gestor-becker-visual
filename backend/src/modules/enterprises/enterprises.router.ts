import { Router } from 'express';
import { enterprisesController } from './enterprises.controller';
import { authorize } from '../../middlewares/authorize';

export const enterprisesRouter = Router();

enterprisesRouter.get('/', authorize('enterprises', 'view'), (req, res) => enterprisesController.getEnterprises(req as any, res));
enterprisesRouter.get('/:id', authorize('enterprises', 'view'), (req, res) => enterprisesController.getEnterprise(req as any, res));
enterprisesRouter.post('/', authorize('enterprises', 'create'), (req, res) => enterprisesController.createEnterprise(req as any, res));
enterprisesRouter.put('/:id', authorize('enterprises', 'edit'), (req, res) => enterprisesController.updateEnterprise(req as any, res));
enterprisesRouter.delete('/:id', authorize('enterprises', 'delete'), (req, res) => enterprisesController.deleteEnterprise(req as any, res));
