import { Router } from 'express';
import { recurringInvoicesController } from './recurring-invoices.controller';
import { authorize } from '../../middlewares/authorize';

export const recurringInvoicesRouter = Router();

recurringInvoicesRouter.get('/', authorize('invoices', 'view'), (req, res) => recurringInvoicesController.list(req as any, res));
recurringInvoicesRouter.post('/', authorize('invoices', 'create'), (req, res) => recurringInvoicesController.create(req as any, res));
recurringInvoicesRouter.put('/:id', authorize('invoices', 'edit'), (req, res) => recurringInvoicesController.update(req as any, res));
recurringInvoicesRouter.post('/:id/deactivate', authorize('invoices', 'edit'), (req, res) => recurringInvoicesController.deactivate(req as any, res));
recurringInvoicesRouter.delete('/:id', authorize('invoices', 'delete'), (req, res) => recurringInvoicesController.delete(req as any, res));
