import { Router } from 'express';
import { priceListsController } from './price-lists.controller';
import { authorize } from '../../middlewares/authorize';

export const priceListsRouter = Router();

// Price resolution (must be before /:id routes)
priceListsRouter.get('/resolve', authorize('products', 'view'), (req, res) => priceListsController.resolvePrice(req as any, res));

// Quantity tiers
priceListsRouter.get('/quantity-tiers', authorize('products', 'view'), (req, res) => priceListsController.getQuantityTiers(req as any, res));

// Price history per product
priceListsRouter.get('/price-history/:productId', authorize('products', 'view'), (req, res) => priceListsController.getPriceHistory(req as any, res));

// Bulk operations management
priceListsRouter.get('/bulk-operations', authorize('products', 'view'), (req, res) => priceListsController.getRecentBulkOperations(req as any, res));
priceListsRouter.post('/bulk-operations/:operationId/undo', authorize('products', 'edit'), (req, res) => priceListsController.undoBulkOperation(req as any, res));
priceListsRouter.post('/bulk-update-with-history', authorize('products', 'edit'), (req, res) => priceListsController.bulkUpdatePriceWithHistory(req as any, res));
priceListsRouter.post('/import-supplier-prices', authorize('products', 'edit'), (req, res) => priceListsController.importSupplierPrices(req as any, res));

// Enterprise linking
priceListsRouter.get('/enterprise-price/:enterpriseId/:productId', authorize('products', 'view'), (req, res) => priceListsController.getEnterprisePriceForProduct(req as any, res));
priceListsRouter.put('/link-enterprise/:enterpriseId', authorize('products', 'edit'), (req, res) => priceListsController.linkEnterpriseToPriceList(req as any, res));

// CRUD for price lists
priceListsRouter.get('/', authorize('products', 'view'), (req, res) => priceListsController.getPriceLists(req as any, res));
priceListsRouter.post('/', authorize('products', 'edit'), (req, res) => priceListsController.createPriceList(req as any, res));
priceListsRouter.get('/:id', authorize('products', 'view'), (req, res) => priceListsController.getPriceList(req as any, res));
priceListsRouter.put('/:id', authorize('products', 'edit'), (req, res) => priceListsController.updatePriceList(req as any, res));
priceListsRouter.delete('/:id', authorize('products', 'delete'), (req, res) => priceListsController.deletePriceList(req as any, res));

// Items (legacy)
priceListsRouter.put('/:id/items', authorize('products', 'edit'), (req, res) => priceListsController.setPriceListItems(req as any, res));

// Rules
priceListsRouter.get('/:id/rules', authorize('products', 'view'), (req, res) => priceListsController.getRules(req as any, res));
priceListsRouter.post('/:id/rules', authorize('products', 'edit'), (req, res) => priceListsController.addRule(req as any, res));
priceListsRouter.put('/:id/rules/:ruleId', authorize('products', 'edit'), (req, res) => priceListsController.updateRule(req as any, res));
priceListsRouter.delete('/:id/rules/:ruleId', authorize('products', 'delete'), (req, res) => priceListsController.deleteRule(req as any, res));

// Resolved prices preview
priceListsRouter.get('/:id/resolved-prices', authorize('products', 'view'), (req, res) => priceListsController.resolveAllPrices(req as any, res));

// Bulk operations on rules
priceListsRouter.post('/:id/bulk', authorize('products', 'edit'), (req, res) => priceListsController.bulkUpdateRules(req as any, res));
