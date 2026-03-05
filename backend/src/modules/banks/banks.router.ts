import { Router } from 'express';
import { banksController } from './banks.controller';

export const banksRouter = Router();

banksRouter.get('/', (req, res) => banksController.getBanks(req as any, res));
banksRouter.get('/breakdown', (req, res) => banksController.getBreakdown(req as any, res));
banksRouter.post('/', (req, res) => banksController.createBank(req as any, res));
banksRouter.put('/:id', (req, res) => banksController.updateBank(req as any, res));
banksRouter.delete('/:id', (req, res) => banksController.deleteBank(req as any, res));
