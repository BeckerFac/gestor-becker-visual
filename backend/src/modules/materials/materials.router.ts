import { Router } from 'express';
import { materialsController } from './materials.controller';
import { authorize } from '../../middlewares/authorize';

export const materialsRouter = Router();

// Materials CRUD
materialsRouter.get('/', authorize('products', 'view'), (req, res) => materialsController.getMaterials(req as any, res));
materialsRouter.post('/', authorize('products', 'create'), (req, res) => materialsController.createMaterial(req as any, res));
materialsRouter.get('/:id', authorize('products', 'view'), (req, res) => materialsController.getMaterial(req as any, res));
materialsRouter.put('/:id', authorize('products', 'edit'), (req, res) => materialsController.updateMaterial(req as any, res));
materialsRouter.delete('/:id', authorize('products', 'delete'), (req, res) => materialsController.deleteMaterial(req as any, res));

// Material stock
materialsRouter.post('/:id/adjust-stock', authorize('products', 'edit'), (req, res) => materialsController.adjustStock(req as any, res));
materialsRouter.get('/:id/movements', authorize('products', 'view'), (req, res) => materialsController.getMovements(req as any, res));

// Product materials (BOM)
materialsRouter.get('/product/:id/materials', authorize('products', 'view'), (req, res) => materialsController.getProductMaterials(req as any, res));
materialsRouter.put('/product/:id/materials', authorize('products', 'edit'), (req, res) => materialsController.setProductMaterials(req as any, res));
materialsRouter.get('/product/:id/bom-cost', authorize('products', 'view'), (req, res) => materialsController.getProductBOMCost(req as any, res));
materialsRouter.get('/product/:id/availability', authorize('products', 'view'), (req, res) => materialsController.checkAvailability(req as any, res));
