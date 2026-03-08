import { Router } from 'express';
import { cobrosController } from './cobros.controller';
import { authorize } from '../../middlewares/authorize';

export const cobrosRouter = Router();

cobrosRouter.get('/', authorize('cobros', 'view'), (req, res) => cobrosController.getCobros(req as any, res));
cobrosRouter.get('/summary', authorize('cobros', 'view'), (req, res) => cobrosController.getSummary(req as any, res));
cobrosRouter.get('/order/:orderId/payment-details', authorize('cobros', 'view'), (req, res) => cobrosController.getOrderPaymentDetails(req as any, res));
cobrosRouter.get('/:id/receipt', authorize('cobros', 'view'), (req, res) => cobrosController.getCobroReceipt(req as any, res));
cobrosRouter.post('/', authorize('cobros', 'create'), (req, res) => cobrosController.createCobro(req as any, res));
cobrosRouter.delete('/:id', authorize('cobros', 'delete'), (req, res) => cobrosController.deleteCobro(req as any, res));
