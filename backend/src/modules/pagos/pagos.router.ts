import { Router } from 'express';
import { pagosController } from './pagos.controller';

export const pagosRouter = Router();

pagosRouter.get('/', (req, res) => pagosController.getPagos(req as any, res));
pagosRouter.get('/summary', (req, res) => pagosController.getSummary(req as any, res));
pagosRouter.post('/', (req, res) => pagosController.createPago(req as any, res));
pagosRouter.delete('/:id', (req, res) => pagosController.deletePago(req as any, res));
