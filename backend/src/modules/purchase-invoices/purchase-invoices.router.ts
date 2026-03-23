import { Router } from 'express';
import { purchaseInvoicesController } from './purchase-invoices.controller';
import { authorize } from '../../middlewares/authorize';

export const purchaseInvoicesRouter = Router();

purchaseInvoicesRouter.get('/', authorize('purchases', 'view'), (req, res) =>
  purchaseInvoicesController.getAll(req as any, res));
purchaseInvoicesRouter.get('/by-purchase/:purchaseId', authorize('purchases', 'view'), (req, res) =>
  purchaseInvoicesController.getByPurchase(req as any, res));
purchaseInvoicesRouter.get('/:id', authorize('purchases', 'view'), (req, res) =>
  purchaseInvoicesController.getOne(req as any, res));
purchaseInvoicesRouter.get('/:id/balance', authorize('purchases', 'view'), (req, res) =>
  purchaseInvoicesController.getPaymentBalance(req as any, res));
purchaseInvoicesRouter.get('/:id/items', authorize('purchases', 'view'), (req, res) =>
  purchaseInvoicesController.getItems(req as any, res));
purchaseInvoicesRouter.post('/', authorize('purchases', 'create'), (req, res) =>
  purchaseInvoicesController.create(req as any, res));
purchaseInvoicesRouter.patch('/:id', authorize('purchases', 'edit'), (req, res) =>
  purchaseInvoicesController.update(req as any, res));
purchaseInvoicesRouter.delete('/:id', authorize('purchases', 'delete'), (req, res) =>
  purchaseInvoicesController.remove(req as any, res));
