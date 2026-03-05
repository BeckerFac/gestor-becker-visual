import { Router } from 'express';
import { inventoryController } from './inventory.controller';

export const inventoryRouter = Router();

inventoryRouter.get('/', (req, res) => inventoryController.getStock(req as any, res));
inventoryRouter.post('/movements', (req, res) => inventoryController.createMovement(req as any, res));
inventoryRouter.get('/low-stock', (req, res) => inventoryController.getLowStock(req as any, res));
