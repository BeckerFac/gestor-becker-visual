import { Router } from 'express';
import { purchasesController } from './purchases.controller';
import { authorize } from '../../middlewares/authorize';

export const purchasesRouter = Router();

purchasesRouter.get('/', authorize('purchases', 'view'), (req, res) => purchasesController.getPurchases(req as any, res));
purchasesRouter.get('/:id', authorize('purchases', 'view'), (req, res) => purchasesController.getPurchase(req as any, res));
purchasesRouter.post('/', authorize('purchases', 'create'), (req, res) => purchasesController.createPurchase(req as any, res));
purchasesRouter.put('/:id', authorize('purchases', 'edit'), (req, res) => purchasesController.updatePurchase(req as any, res));
purchasesRouter.put('/:id/payment-status', authorize('purchases', 'edit'), (req, res) => purchasesController.updatePaymentStatus(req as any, res));
purchasesRouter.delete('/:id', authorize('purchases', 'delete'), (req, res) => purchasesController.deletePurchase(req as any, res));
