import { Router } from 'express';
import { invoicesController } from './invoices.controller';
import { authorize } from '../../middlewares/authorize';

export const invoicesRouter = Router();

invoicesRouter.get('/', authorize('invoices', 'view'), (req, res) => invoicesController.getInvoices(req, res));
invoicesRouter.post('/', authorize('invoices', 'create'), (req, res) => invoicesController.createInvoice(req, res));
invoicesRouter.post('/import', authorize('invoices', 'create'), (req, res) => invoicesController.importInvoice(req, res));
invoicesRouter.get('/:id', authorize('invoices', 'view'), (req, res) => invoicesController.getInvoice(req, res));
invoicesRouter.put('/:id', authorize('invoices', 'edit'), (req, res) => invoicesController.updateDraftInvoice(req, res));
invoicesRouter.delete('/:id', authorize('invoices', 'delete'), (req, res) => invoicesController.deleteDraftInvoice(req, res));
invoicesRouter.post('/:id/authorize', authorize('invoices', 'edit'), (req, res) => invoicesController.authorizeInvoice(req, res));
invoicesRouter.post('/:id/link-order', authorize('invoices', 'edit'), (req, res) => invoicesController.linkOrder(req, res));
invoicesRouter.delete('/:id/link-order', authorize('invoices', 'edit'), (req, res) => invoicesController.unlinkOrder(req, res));
invoicesRouter.post('/:id/payment-link', authorize('invoices', 'edit'), (req, res) => invoicesController.generatePaymentLink(req, res));
invoicesRouter.get('/available-order-items', authorize('invoices', 'view'), (req, res) => invoicesController.getAvailableOrderItems(req as any, res));
invoicesRouter.get('/:id/items-remaining', authorize('invoices', 'view'), (req, res) => invoicesController.getInvoiceItemsWithRemaining(req as any, res));
invoicesRouter.get('/order/:orderId/remaining', authorize('invoices', 'view'), (req, res) => invoicesController.getOrderRemainingToInvoice(req as any, res));
invoicesRouter.get('/order/:orderId/invoices', authorize('invoices', 'view'), (req, res) => invoicesController.getInvoicesByOrder(req as any, res));
