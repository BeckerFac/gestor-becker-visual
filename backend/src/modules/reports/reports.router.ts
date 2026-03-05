import { Router } from 'express';
import { reportsController } from './reports.controller';

export const reportsRouter = Router();

reportsRouter.get('/dashboard', (req, res) => reportsController.getDashboard(req as any, res));
reportsRouter.get('/sales', (req, res) => reportsController.getSalesReport(req as any, res));
reportsRouter.get('/top-products', (req, res) => reportsController.getTopProducts(req as any, res));
reportsRouter.get('/search', (req, res) => reportsController.globalSearch(req as any, res));
