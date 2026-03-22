import { Router } from 'express';
import { banksController } from './banks.controller';
import { authorize } from '../../middlewares/authorize';

export const banksRouter = Router();

banksRouter.get('/', authorize('banks', 'view'), (req, res) => banksController.getBanks(req as any, res));
banksRouter.get('/breakdown', authorize('banks', 'view'), (req, res) => banksController.getBreakdown(req as any, res));
banksRouter.get('/balances', authorize('banks', 'view'), (req, res) => banksController.getBankBalances(req as any, res));
banksRouter.get('/:id/movements', authorize('banks', 'view'), (req, res) => banksController.getBankMovements(req as any, res));
banksRouter.get('/:bankId/method/:method/transactions', authorize('banks', 'view'), (req, res) => banksController.getTransactionsByBankAndMethod(req as any, res));
banksRouter.post('/', authorize('banks', 'create'), (req, res) => banksController.createBank(req as any, res));
banksRouter.put('/:id', authorize('banks', 'edit'), (req, res) => banksController.updateBank(req as any, res));
banksRouter.delete('/:id', authorize('banks', 'delete'), (req, res) => banksController.deleteBank(req as any, res));
