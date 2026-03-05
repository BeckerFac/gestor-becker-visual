import { Router } from 'express';
import { purchasesController } from './purchases.controller';

export const purchasesRouter = Router();

purchasesRouter.get('/', (req, res) => purchasesController.getPurchases(req as any, res));
purchasesRouter.get('/:id', (req, res) => purchasesController.getPurchase(req as any, res));
purchasesRouter.post('/', (req, res) => purchasesController.createPurchase(req as any, res));
purchasesRouter.put('/:id/payment-status', (req, res) => purchasesController.updatePaymentStatus(req as any, res));
purchasesRouter.delete('/:id', (req, res) => purchasesController.deletePurchase(req as any, res));
