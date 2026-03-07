import { Router } from 'express';
import { cobrosController } from './cobros.controller';

export const cobrosRouter = Router();

cobrosRouter.get('/', (req, res) => cobrosController.getCobros(req as any, res));
cobrosRouter.get('/summary', (req, res) => cobrosController.getSummary(req as any, res));
cobrosRouter.get('/order/:orderId/payment-details', (req, res) => cobrosController.getOrderPaymentDetails(req as any, res));
cobrosRouter.get('/:id/receipt', (req, res) => cobrosController.getCobroReceipt(req as any, res));
cobrosRouter.post('/', (req, res) => cobrosController.createCobro(req as any, res));
cobrosRouter.delete('/:id', (req, res) => cobrosController.deleteCobro(req as any, res));
