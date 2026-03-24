import { Router } from 'express';
import { accountingController } from './accounting.controller';
import { authorize } from '../../middlewares/authorize';

export const accountingRouter = Router();

accountingRouter.get('/chart', authorize('accounting', 'view'), (req, res) => accountingController.getChartOfAccounts(req as any, res));
accountingRouter.post('/chart', authorize('accounting', 'create'), (req, res) => accountingController.createAccount(req as any, res));
accountingRouter.get('/entries', authorize('accounting', 'view'), (req, res) => accountingController.getEntries(req as any, res));
accountingRouter.post('/entries', authorize('accounting', 'create'), (req, res) => accountingController.createManualEntry(req as any, res));
accountingRouter.delete('/entries/:id', authorize('accounting', 'delete'), (req, res) => accountingController.deleteEntry(req as any, res));
accountingRouter.get('/balance', authorize('accounting', 'view'), (req, res) => accountingController.getBalance(req as any, res));
accountingRouter.get('/ledger', authorize('accounting', 'view'), (req, res) => accountingController.getLedger(req as any, res));
accountingRouter.get('/balance-sheet', authorize('accounting', 'view'), (req, res) => accountingController.getBalanceSheet(req as any, res));
accountingRouter.get('/income-statement', authorize('accounting', 'view'), (req, res) => accountingController.getIncomeStatement(req as any, res));
accountingRouter.post('/opening-entry', authorize('accounting', 'create'), (req, res) => accountingController.createOpeningEntry(req as any, res));
accountingRouter.post('/seed', authorize('accounting', 'create'), (req, res) => accountingController.seedChart(req as any, res));
accountingRouter.post('/enable', authorize('accounting', 'create'), (req, res) => accountingController.enableAccounting(req as any, res));
