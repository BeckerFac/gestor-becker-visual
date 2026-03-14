import { Router } from 'express';
import { priceListsController } from './price-lists.controller';
import { authorize } from '../../middlewares/authorize';

export const priceListsRouter = Router();

priceListsRouter.get('/', authorize('products', 'view'), (req, res) => priceListsController.getPriceLists(req as any, res));
priceListsRouter.post('/', authorize('products', 'edit'), (req, res) => priceListsController.createPriceList(req as any, res));
priceListsRouter.get('/enterprise-price/:enterpriseId/:productId', authorize('products', 'view'), (req, res) => priceListsController.getEnterprisePriceForProduct(req as any, res));
priceListsRouter.put('/link-enterprise/:enterpriseId', authorize('products', 'edit'), (req, res) => priceListsController.linkEnterpriseToPriceList(req as any, res));
priceListsRouter.get('/:id', authorize('products', 'view'), (req, res) => priceListsController.getPriceList(req as any, res));
priceListsRouter.put('/:id', authorize('products', 'edit'), (req, res) => priceListsController.updatePriceList(req as any, res));
priceListsRouter.delete('/:id', authorize('products', 'delete'), (req, res) => priceListsController.deletePriceList(req as any, res));
priceListsRouter.put('/:id/items', authorize('products', 'edit'), (req, res) => priceListsController.setPriceListItems(req as any, res));
