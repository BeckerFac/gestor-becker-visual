import { Router } from 'express';
import { productsController } from './products.controller';
import { productComponentsController } from '../product-components/product-components.controller';
import { authorize } from '../../middlewares/authorize';

export const productsRouter = Router();

productsRouter.get('/', authorize('products', 'view'), (req, res) => productsController.getProducts(req, res));
productsRouter.get('/types', authorize('products', 'view'), (req, res) => productsController.getProductTypes(req, res));
productsRouter.get('/categories', authorize('products', 'view'), (req, res) => productsController.getCategories(req, res));
productsRouter.post('/categories', authorize('products', 'create'), (req, res) => productsController.createCategory(req, res));
productsRouter.delete('/categories/:id', authorize('products', 'delete'), (req, res) => productsController.deleteCategory(req, res));
productsRouter.post('/bulk-price', authorize('products', 'edit'), (req, res) => productsController.bulkUpdatePrice(req, res));
productsRouter.post('/', authorize('products', 'create'), (req, res) => productsController.createProduct(req, res));
productsRouter.get('/:id', authorize('products', 'view'), (req, res) => productsController.getProduct(req, res));
productsRouter.put('/:id', authorize('products', 'edit'), (req, res) => productsController.updateProduct(req, res));
productsRouter.delete('/:id', authorize('products', 'delete'), (req, res) => productsController.deleteProduct(req, res));

// Product components (BOM)
productsRouter.get('/:id/components', authorize('products', 'view'), (req, res) => productComponentsController.getComponents(req as any, res));
productsRouter.post('/:id/components', authorize('products', 'create'), (req, res) => productComponentsController.addComponent(req as any, res));
productsRouter.put('/:id/components/:componentId', authorize('products', 'edit'), (req, res) => productComponentsController.updateComponent(req as any, res));
productsRouter.delete('/:id/components/:componentId', authorize('products', 'delete'), (req, res) => productComponentsController.removeComponent(req as any, res));
productsRouter.get('/:id/bom-cost', authorize('products', 'view'), (req, res) => productComponentsController.getBOMCost(req as any, res));
productsRouter.get('/:id/bom-availability', authorize('products', 'view'), (req, res) => productComponentsController.checkAvailability(req as any, res));
productsRouter.get('/:id/used-in', authorize('products', 'view'), (req, res) => productComponentsController.getProductsUsing(req as any, res));
