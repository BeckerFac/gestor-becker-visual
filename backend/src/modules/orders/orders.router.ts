import { Router } from 'express';
import { ordersController } from './orders.controller';

export const ordersRouter = Router();

ordersRouter.get('/', (req, res) => ordersController.getOrders(req as any, res));
ordersRouter.post('/', (req, res) => ordersController.createOrder(req as any, res));
ordersRouter.get('/without-invoice', (req, res) => ordersController.getOrdersWithoutInvoice(req as any, res));
ordersRouter.get('/:id/invoicing-status', (req, res) => ordersController.getInvoicingStatus(req as any, res));
ordersRouter.get('/:id/uninvoiced-items', (req, res) => ordersController.getUninvoicedItems(req as any, res));
ordersRouter.get('/:id', (req, res) => ordersController.getOrder(req as any, res));
ordersRouter.put('/:id', (req, res) => ordersController.updateOrder(req as any, res));
ordersRouter.delete('/:id', (req, res) => ordersController.deleteOrder(req as any, res));
ordersRouter.post('/:id/status', (req, res) => ordersController.updateStatus(req as any, res));
ordersRouter.post('/:id/link-invoice', (req, res) => ordersController.linkInvoice(req as any, res));
