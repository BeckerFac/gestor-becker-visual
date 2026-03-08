import { Router } from 'express';
import { ordersController } from './orders.controller';
import { authorize } from '../../middlewares/authorize';

export const ordersRouter = Router();

ordersRouter.get('/', authorize('orders', 'view'), (req, res) => ordersController.getOrders(req as any, res));
ordersRouter.post('/', authorize('orders', 'create'), (req, res) => ordersController.createOrder(req as any, res));
ordersRouter.get('/without-invoice', authorize('orders', 'view'), (req, res) => ordersController.getOrdersWithoutInvoice(req as any, res));
ordersRouter.get('/:id/invoicing-status', authorize('orders', 'view'), (req, res) => ordersController.getInvoicingStatus(req as any, res));
ordersRouter.get('/:id/uninvoiced-items', authorize('orders', 'view'), (req, res) => ordersController.getUninvoicedItems(req as any, res));
ordersRouter.get('/:id', authorize('orders', 'view'), (req, res) => ordersController.getOrder(req as any, res));
ordersRouter.put('/:id', authorize('orders', 'edit'), (req, res) => ordersController.updateOrder(req as any, res));
ordersRouter.delete('/:id', authorize('orders', 'delete'), (req, res) => ordersController.deleteOrder(req as any, res));
ordersRouter.post('/:id/status', authorize('orders', 'edit'), (req, res) => ordersController.updateStatus(req as any, res));
ordersRouter.post('/:id/link-invoice', authorize('orders', 'edit'), (req, res) => ordersController.linkInvoice(req as any, res));
