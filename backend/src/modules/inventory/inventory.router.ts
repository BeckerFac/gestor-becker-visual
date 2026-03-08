import { Router } from 'express';
import { inventoryController } from './inventory.controller';
import { authorize } from '../../middlewares/authorize';

export const inventoryRouter = Router();

inventoryRouter.get('/', authorize('inventory', 'view'), (req, res) => inventoryController.getStock(req as any, res));
inventoryRouter.post('/movements', authorize('inventory', 'create'), (req, res) => inventoryController.createMovement(req as any, res));
inventoryRouter.get('/low-stock', authorize('inventory', 'view'), (req, res) => inventoryController.getLowStock(req as any, res));
