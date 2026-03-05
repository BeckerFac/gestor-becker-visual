import { Router } from 'express';
import { chequesController } from './cheques.controller';

export const chequesRouter = Router();

chequesRouter.get('/', (req, res) => chequesController.getCheques(req as any, res));
chequesRouter.get('/summary', (req, res) => chequesController.getSummary(req as any, res));
chequesRouter.post('/', (req, res) => chequesController.createCheque(req as any, res));
chequesRouter.put('/:id/status', (req, res) => chequesController.updateStatus(req as any, res));
