import { Router } from 'express';
import { receiptsController } from './receipts.controller';
import { authorize } from '../../middlewares/authorize';

export const receiptsRouter = Router();

receiptsRouter.get('/', authorize('cobros', 'view'), (req, res) => receiptsController.getReceipts(req as any, res));
receiptsRouter.post('/', authorize('cobros', 'create'), (req, res) => receiptsController.createReceipt(req as any, res));
receiptsRouter.delete('/:id', authorize('cobros', 'delete'), (req, res) => receiptsController.deleteReceipt(req as any, res));
