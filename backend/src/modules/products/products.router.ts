import { Router } from 'express';
import { productsController } from './products.controller';
import { productComponentsController } from '../product-components/product-components.controller';

export const productsRouter = Router();

productsRouter.get('/', (req, res) => productsController.getProducts(req, res));
productsRouter.post('/', (req, res) => productsController.createProduct(req, res));
productsRouter.get('/:id', (req, res) => productsController.getProduct(req, res));
productsRouter.put('/:id', (req, res) => productsController.updateProduct(req, res));
productsRouter.delete('/:id', (req, res) => productsController.deleteProduct(req, res));

// Product components (BOM)
productsRouter.get('/:id/components', (req, res) => productComponentsController.getComponents(req as any, res));
productsRouter.post('/:id/components', (req, res) => productComponentsController.addComponent(req as any, res));
productsRouter.put('/:id/components/:componentId', (req, res) => productComponentsController.updateComponent(req as any, res));
productsRouter.delete('/:id/components/:componentId', (req, res) => productComponentsController.removeComponent(req as any, res));
productsRouter.get('/:id/bom-cost', (req, res) => productComponentsController.getBOMCost(req as any, res));
productsRouter.get('/:id/bom-availability', (req, res) => productComponentsController.checkAvailability(req as any, res));
productsRouter.get('/:id/used-in', (req, res) => productComponentsController.getProductsUsing(req as any, res));
