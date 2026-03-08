import { Router } from 'express';
import { pagosController } from './pagos.controller';
import { authorize } from '../../middlewares/authorize';

export const pagosRouter = Router();

pagosRouter.get('/', authorize('pagos', 'view'), (req, res) => pagosController.getPagos(req as any, res));
pagosRouter.get('/summary', authorize('pagos', 'view'), (req, res) => pagosController.getSummary(req as any, res));
pagosRouter.post('/', authorize('pagos', 'create'), (req, res) => pagosController.createPago(req as any, res));
pagosRouter.delete('/:id', authorize('pagos', 'delete'), (req, res) => pagosController.deletePago(req as any, res));
