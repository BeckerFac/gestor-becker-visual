import { Router } from 'express';
import { retencionesController } from './retenciones.controller';
import { authorize } from '../../middlewares/authorize';

export const retencionesRouter = Router();

retencionesRouter.get('/', authorize('retenciones', 'view'), (req, res) => retencionesController.getRetentions(req as any, res));
retencionesRouter.get('/summary', authorize('retenciones', 'view'), (req, res) => retencionesController.getSummary(req as any, res));

// Legacy: GET /calculate with ?enterprise_id&amount — bulk calc for a pago.
retencionesRouter.get('/calculate', authorize('retenciones', 'view'), (req, res) => retencionesController.calculateForPago(req as any, res));

// H8: POST /calculate — single-retention preview for UI before create.
retencionesRouter.post('/calculate', authorize('retenciones', 'view'), (req, res) => retencionesController.calculatePreview(req as any, res));

retencionesRouter.post('/', authorize('retenciones', 'create'), (req, res) => retencionesController.createRetention(req as any, res));
retencionesRouter.post('/import-padron', authorize('retenciones', 'create'), (req, res) => retencionesController.importPadron(req as any, res));
retencionesRouter.delete('/:id', authorize('retenciones', 'delete'), (req, res) => retencionesController.deleteRetention(req as any, res));

// H8: retenciones are immutable. PUT/PATCH return 405.
retencionesRouter.put('/:id', authorize('retenciones', 'update'), (req, res) => retencionesController.rejectUpdate(req as any, res));
retencionesRouter.patch('/:id', authorize('retenciones', 'update'), (req, res) => retencionesController.rejectUpdate(req as any, res));
