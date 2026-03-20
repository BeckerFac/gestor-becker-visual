import { Router } from 'express';
import { productsController } from './products.controller';
import { productComponentsController } from '../product-components/product-components.controller';
import { priceCriteriaController } from '../price-criteria/price-criteria.controller';
import { authorize } from '../../middlewares/authorize';

export const productsRouter = Router();

productsRouter.get('/', authorize('products', 'view'), (req, res) => productsController.getProducts(req, res));
productsRouter.get('/types', authorize('products', 'view'), (req, res) => productsController.getProductTypes(req, res));
productsRouter.post('/types', authorize('products', 'create'), (req, res) => productsController.createProductType(req, res));
productsRouter.post('/types/reorder', authorize('products', 'edit'), (req, res) => productsController.reorderProductTypes(req, res));
productsRouter.put('/types/:id', authorize('products', 'edit'), (req, res) => productsController.updateProductType(req, res));
productsRouter.delete('/types/:id', authorize('products', 'delete'), (req, res) => productsController.deleteProductType(req, res));
productsRouter.get('/category-tree', authorize('products', 'view'), (req, res) => productsController.getCategoryTree(req, res));
productsRouter.get('/by-category', authorize('products', 'view'), (req, res) => productsController.getProductsByCategory(req, res));
productsRouter.get('/categories', authorize('products', 'view'), (req, res) => productsController.getCategories(req, res));
productsRouter.post('/categories', authorize('products', 'create'), (req, res) => productsController.createCategory(req, res));
productsRouter.post('/categories/reorder', authorize('products', 'edit'), (req, res) => productsController.reorderCategories(req, res));
productsRouter.put('/categories/:id', authorize('products', 'edit'), (req, res) => productsController.updateCategory(req, res));
productsRouter.get('/categories/:id/defaults', authorize('products', 'view'), (req, res) => productsController.getCategoryDefaults(req, res));
productsRouter.delete('/categories/:id', authorize('products', 'delete'), (req, res) => productsController.deleteCategory(req, res));
productsRouter.post('/bulk-price', authorize('products', 'edit'), (req, res) => productsController.bulkUpdatePrice(req, res));
productsRouter.post('/bulk-price-preview', authorize('products', 'view'), (req, res) => productsController.bulkPricePreview(req, res));
productsRouter.post('/', authorize('products', 'create'), (req, res) => productsController.createProduct(req, res));
productsRouter.get('/:id', authorize('products', 'view'), (req, res) => productsController.getProduct(req, res));
productsRouter.put('/:id', authorize('products', 'edit'), (req, res) => productsController.updateProduct(req, res));
productsRouter.delete('/:id', authorize('products', 'delete'), (req, res) => productsController.deleteProduct(req, res));

// Product prices (per criteria)
productsRouter.get('/:id/prices', authorize('products', 'view'), (req, res) => priceCriteriaController.getProductPrices(req as any, res));
productsRouter.put('/:id/prices', authorize('products', 'edit'), (req, res) => priceCriteriaController.setProductPrices(req as any, res));

// Product components (BOM)
productsRouter.get('/:id/components', authorize('products', 'view'), (req, res) => productComponentsController.getComponents(req as any, res));
productsRouter.post('/:id/components', authorize('products', 'create'), (req, res) => productComponentsController.addComponent(req as any, res));
productsRouter.put('/:id/components/:componentId', authorize('products', 'edit'), (req, res) => productComponentsController.updateComponent(req as any, res));
productsRouter.delete('/:id/components/:componentId', authorize('products', 'delete'), (req, res) => productComponentsController.removeComponent(req as any, res));
productsRouter.get('/:id/bom-cost', authorize('products', 'view'), (req, res) => productComponentsController.getBOMCost(req as any, res));
productsRouter.get('/:id/bom-availability', authorize('products', 'view'), (req, res) => productComponentsController.checkAvailability(req as any, res));
productsRouter.get('/:id/used-in', authorize('products', 'view'), (req, res) => productComponentsController.getProductsUsing(req as any, res));
