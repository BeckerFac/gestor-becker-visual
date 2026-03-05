import { Router } from 'express';
import { invoicesController } from './invoices.controller';

export const invoicesRouter = Router();

invoicesRouter.get('/', (req, res) => invoicesController.getInvoices(req, res));
invoicesRouter.post('/', (req, res) => invoicesController.createInvoice(req, res));
invoicesRouter.get('/:id', (req, res) => invoicesController.getInvoice(req, res));
invoicesRouter.put('/:id', (req, res) => invoicesController.updateDraftInvoice(req, res));
invoicesRouter.delete('/:id', (req, res) => invoicesController.deleteDraftInvoice(req, res));
invoicesRouter.post('/:id/authorize', (req, res) => invoicesController.authorizeInvoice(req, res));
invoicesRouter.post('/:id/link-order', (req, res) => invoicesController.linkOrder(req, res));
invoicesRouter.delete('/:id/link-order', (req, res) => invoicesController.unlinkOrder(req, res));
