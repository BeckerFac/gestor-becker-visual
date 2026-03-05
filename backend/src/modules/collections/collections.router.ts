import { Router } from 'express';
import { collectionsController } from './collections.controller';

export const collectionsRouter = Router();

collectionsRouter.get('/', (req, res) => collectionsController.getPendingInvoices(req as any, res));
collectionsRouter.get('/summary', (req, res) => collectionsController.getSummary(req as any, res));
collectionsRouter.get('/pending-orders', (req, res) => collectionsController.getPendingOrders(req as any, res));
collectionsRouter.post('/orders/:orderId/pay', (req, res) => collectionsController.markOrderAsPaid(req as any, res));
collectionsRouter.post('/:invoiceId/payments', (req, res) => collectionsController.registerPayment(req as any, res));
