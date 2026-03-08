import { Router } from 'express';
import { reportsController } from './reports.controller';
import { authorize } from '../../middlewares/authorize';

export const reportsRouter = Router();

reportsRouter.get('/dashboard', authorize('dashboard', 'view'), (req, res) => reportsController.getDashboard(req as any, res));
reportsRouter.get('/sales', authorize('dashboard', 'view'), (req, res) => reportsController.getSalesReport(req as any, res));
reportsRouter.get('/top-products', authorize('dashboard', 'view'), (req, res) => reportsController.getTopProducts(req as any, res));
reportsRouter.get('/search', authorize('dashboard', 'view'), (req, res) => reportsController.globalSearch(req as any, res));
