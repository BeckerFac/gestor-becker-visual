import { Router } from 'express';
import { retencionesController } from './retenciones.controller';
import { authorize } from '../../middlewares/authorize';

export const retencionesRouter = Router();

retencionesRouter.get('/', authorize('retenciones', 'view'), (req, res) => retencionesController.getRetentions(req as any, res));
retencionesRouter.get('/summary', authorize('retenciones', 'view'), (req, res) => retencionesController.getSummary(req as any, res));
retencionesRouter.get('/calculate', authorize('retenciones', 'view'), (req, res) => retencionesController.calculateForPago(req as any, res));
retencionesRouter.post('/', authorize('retenciones', 'create'), (req, res) => retencionesController.createRetention(req as any, res));
retencionesRouter.post('/import-padron', authorize('retenciones', 'create'), (req, res) => retencionesController.importPadron(req as any, res));
retencionesRouter.delete('/:id', authorize('retenciones', 'delete'), (req, res) => retencionesController.deleteRetention(req as any, res));
