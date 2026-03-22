import { Router } from 'express';
import { portalController } from './portal.controller';
import { authMiddleware } from '../../middlewares/auth';
import { requireMinRole } from '../../middlewares/authorize';

export const portalRouter = Router();

// Admin-only config endpoints (require admin auth, not customer)
portalRouter.get('/config', authMiddleware, requireMinRole('admin'), (req, res) => portalController.getConfig(req, res));
portalRouter.put('/config', authMiddleware, requireMinRole('admin'), (req, res) => portalController.updateConfig(req, res));

// Admin preview token
portalRouter.post('/preview-token', authMiddleware, requireMinRole('admin'), (req, res) => portalController.generatePreviewToken(req as any, res));

// Customer-facing endpoints (customer JWT)
portalRouter.use(authMiddleware);

portalRouter.get('/public-config', (req, res) => portalController.getPublicConfig(req, res));
portalRouter.get('/summary', (req, res) => portalController.getSummary(req, res));
portalRouter.get('/profile', (req, res) => portalController.getProfile(req, res));
portalRouter.get('/orders', (req, res) => portalController.getOrders(req, res));
portalRouter.get('/orders/:id', (req, res) => portalController.getOrder(req, res));
portalRouter.get('/invoices', (req, res) => portalController.getInvoices(req, res));
portalRouter.get('/quotes', (req, res) => portalController.getQuotes(req, res));
portalRouter.get('/quotes/:id/pdf', (req, res) => portalController.getQuotePdf(req, res));
portalRouter.put('/quotes/:id/status', (req, res) => portalController.updateQuoteStatus(req, res));
portalRouter.get('/remitos', (req, res) => portalController.getRemitos(req, res));
