import { Router } from 'express';
import { reportsController } from './reports.controller';
import { authorize } from '../../middlewares/authorize';

export const reportsRouter = Router();

reportsRouter.get('/dashboard', authorize('dashboard', 'view'), (req, res) => reportsController.getDashboard(req as any, res));
reportsRouter.get('/sales', authorize('dashboard', 'view'), (req, res) => reportsController.getSalesReport(req as any, res));
reportsRouter.get('/top-products', authorize('dashboard', 'view'), (req, res) => reportsController.getTopProducts(req as any, res));
reportsRouter.get('/insights', authorize('dashboard', 'view'), (req, res) => reportsController.getInsights(req as any, res));
reportsRouter.get('/search', authorize('dashboard', 'view'), (req, res) => reportsController.globalSearch(req as any, res));
reportsRouter.get('/libro-iva-ventas', authorize('dashboard', 'view'), (req, res) => reportsController.getLibroIVAVentas(req as any, res));
reportsRouter.get('/libro-iva-compras', authorize('dashboard', 'view'), (req, res) => reportsController.getLibroIVACompras(req as any, res));
reportsRouter.get('/posicion-iva', authorize('dashboard', 'view'), (req, res) => reportsController.getPosicionIVA(req as any, res));
reportsRouter.get('/flujo-caja', authorize('dashboard', 'view'), (req, res) => reportsController.getFlujoCaja(req as any, res));
