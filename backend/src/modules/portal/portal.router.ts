import { Router } from 'express';
import { portalController } from './portal.controller';
import { authMiddleware } from '../../middlewares/auth';

export const portalRouter = Router();

// All portal routes require authentication (customer JWT)
portalRouter.use(authMiddleware);

portalRouter.get('/summary', (req, res) => portalController.getSummary(req, res));
portalRouter.get('/profile', (req, res) => portalController.getProfile(req, res));
portalRouter.get('/orders', (req, res) => portalController.getOrders(req, res));
portalRouter.get('/orders/:id', (req, res) => portalController.getOrder(req, res));
portalRouter.get('/invoices', (req, res) => portalController.getInvoices(req, res));
portalRouter.get('/quotes', (req, res) => portalController.getQuotes(req, res));
portalRouter.get('/quotes/:id/pdf', (req, res) => portalController.getQuotePdf(req, res));
