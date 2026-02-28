import { Router } from 'express';
import { productsController } from './products.controller';

export const productsRouter = Router();

productsRouter.get('/', (req, res) => productsController.getProducts(req, res));
productsRouter.post('/', (req, res) => productsController.createProduct(req, res));
productsRouter.get('/:id', (req, res) => productsController.getProduct(req, res));
productsRouter.put('/:id', (req, res) => productsController.updateProduct(req, res));
productsRouter.delete('/:id', (req, res) => productsController.deleteProduct(req, res));
