import { Router } from 'express';
import { reportsController } from './reports.controller';
import { authorize } from '../../middlewares/authorize';
import { requireFeature } from '../../middlewares/featureGate';

export const reportsRouter = Router();

reportsRouter.get('/dashboard', authorize('dashboard', 'view'), (req, res) => reportsController.getDashboard(req as any, res));
reportsRouter.get('/sales', authorize('dashboard', 'view'), (req, res) => reportsController.getSalesReport(req as any, res));
reportsRouter.get('/top-products', authorize('dashboard', 'view'), (req, res) => reportsController.getTopProducts(req as any, res));
reportsRouter.get('/insights', authorize('dashboard', 'view'), (req, res) => reportsController.getInsights(req as any, res));
reportsRouter.get('/aging', authorize('dashboard', 'view'), (req, res) => reportsController.getAgingReport(req as any, res));
reportsRouter.get('/search', authorize('dashboard', 'view'), (req, res) => reportsController.globalSearch(req as any, res));
reportsRouter.get('/libro-iva-ventas', authorize('dashboard', 'view'), (req, res) => reportsController.getLibroIVAVentas(req as any, res));
reportsRouter.get('/libro-iva-compras', authorize('dashboard', 'view'), (req, res) => reportsController.getLibroIVACompras(req as any, res));
reportsRouter.get('/posicion-iva', authorize('dashboard', 'view'), (req, res) => reportsController.getPosicionIVA(req as any, res));
reportsRouter.get('/flujo-caja', authorize('dashboard', 'view'), (req, res) => reportsController.getFlujoCaja(req as any, res));

// Business Intelligence Reports
// Basic (Estandar): ventas
reportsRouter.get('/business/ventas', authorize('dashboard', 'view'), (req, res) => reportsController.getBusinessVentas(req as any, res));

// Advanced (Premium-only): rentabilidad, clientes, cobranzas, inventario, conversion
reportsRouter.get('/business/rentabilidad', authorize('dashboard', 'view'), requireFeature('advanced_reports'), (req, res) => reportsController.getBusinessRentabilidad(req as any, res));
reportsRouter.get('/business/clientes', authorize('dashboard', 'view'), requireFeature('advanced_reports'), (req, res) => reportsController.getBusinessClientes(req as any, res));
reportsRouter.get('/business/cobranzas', authorize('dashboard', 'view'), requireFeature('advanced_reports'), (req, res) => reportsController.getBusinessCobranzas(req as any, res));
reportsRouter.get('/business/inventario', authorize('dashboard', 'view'), requireFeature('advanced_reports'), (req, res) => reportsController.getBusinessInventario(req as any, res));
reportsRouter.get('/business/conversion', authorize('dashboard', 'view'), requireFeature('advanced_reports'), (req, res) => reportsController.getBusinessConversion(req as any, res));
