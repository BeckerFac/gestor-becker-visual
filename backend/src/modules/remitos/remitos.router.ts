import { Router } from 'express';
import { remitosController } from './remitos.controller';
import { authorize } from '../../middlewares/authorize';

export const remitosRouter = Router();

remitosRouter.get('/', authorize('remitos', 'view'), (req, res) => remitosController.getRemitos(req as any, res));
remitosRouter.post('/', authorize('remitos', 'create'), (req, res) => remitosController.createRemito(req as any, res));
remitosRouter.get('/:id', authorize('remitos', 'view'), (req, res) => remitosController.getRemito(req as any, res));
remitosRouter.get('/:id/pdf', authorize('remitos', 'view'), (req, res) => remitosController.downloadPdf(req as any, res));
remitosRouter.put('/:id/status', authorize('remitos', 'edit'), (req, res) => remitosController.updateStatus(req as any, res));
remitosRouter.delete('/:id', authorize('remitos', 'delete'), (req, res) => remitosController.deleteRemito(req as any, res));
remitosRouter.post('/:id/signed-pdf', authorize('remitos', 'edit'), (req, res) => remitosController.uploadSignedPdf(req as any, res));
remitosRouter.get('/:id/signed-pdf', authorize('remitos', 'view'), (req, res) => remitosController.getSignedPdf(req as any, res));
