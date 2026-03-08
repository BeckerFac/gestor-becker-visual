import { Router } from 'express';
import { chequesController } from './cheques.controller';
import { authorize } from '../../middlewares/authorize';

export const chequesRouter = Router();

chequesRouter.get('/', authorize('cheques', 'view'), (req, res) => chequesController.getCheques(req as any, res));
chequesRouter.get('/summary', authorize('cheques', 'view'), (req, res) => chequesController.getSummary(req as any, res));
chequesRouter.post('/', authorize('cheques', 'create'), (req, res) => chequesController.createCheque(req as any, res));
chequesRouter.put('/:id', authorize('cheques', 'edit'), (req, res) => chequesController.updateCheque(req as any, res));
chequesRouter.delete('/:id', authorize('cheques', 'delete'), (req, res) => chequesController.deleteCheque(req as any, res));
chequesRouter.put('/:id/status', authorize('cheques', 'edit'), (req, res) => chequesController.updateStatus(req as any, res));
chequesRouter.get('/:id/history', authorize('cheques', 'view'), (req, res) => chequesController.getStatusHistory(req as any, res));
