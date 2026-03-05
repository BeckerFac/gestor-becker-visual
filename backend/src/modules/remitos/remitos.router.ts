import { Router } from 'express';
import { remitosController } from './remitos.controller';

export const remitosRouter = Router();

remitosRouter.get('/', (req, res) => remitosController.getRemitos(req as any, res));
remitosRouter.post('/', (req, res) => remitosController.createRemito(req as any, res));
remitosRouter.get('/:id/pdf', (req, res) => remitosController.downloadPdf(req as any, res));
remitosRouter.put('/:id/status', (req, res) => remitosController.updateStatus(req as any, res));
remitosRouter.delete('/:id', (req, res) => remitosController.deleteRemito(req as any, res));
