import { Router } from 'express';
import { invoicesController } from './invoices.controller';

export const invoicesRouter = Router();

invoicesRouter.get('/', (req, res) => invoicesController.getInvoices(req, res));
invoicesRouter.post('/', (req, res) => invoicesController.createInvoice(req, res));
invoicesRouter.get('/:id', (req, res) => invoicesController.getInvoice(req, res));
invoicesRouter.post('/:id/authorize', (req, res) => invoicesController.authorizeInvoice(req, res));
