import { Router } from 'express';
import { enterprisesController } from './enterprises.controller';

export const enterprisesRouter = Router();

enterprisesRouter.get('/', (req, res) => enterprisesController.getEnterprises(req as any, res));
enterprisesRouter.get('/:id', (req, res) => enterprisesController.getEnterprise(req as any, res));
enterprisesRouter.post('/', (req, res) => enterprisesController.createEnterprise(req as any, res));
enterprisesRouter.put('/:id', (req, res) => enterprisesController.updateEnterprise(req as any, res));
enterprisesRouter.delete('/:id', (req, res) => enterprisesController.deleteEnterprise(req as any, res));
