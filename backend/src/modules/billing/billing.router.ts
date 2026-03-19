import { Router } from 'express';
import { billingController } from './billing.controller';
import { authMiddleware } from '../../middlewares/auth';

export const billingRouter = Router();

// Authenticated endpoints
billingRouter.get('/subscription', authMiddleware, (req, res) => billingController.getSubscription(req, res));
billingRouter.get('/plans', authMiddleware, (req, res) => billingController.getPlans(req, res));
billingRouter.get('/usage', authMiddleware, (req, res) => billingController.getUsage(req, res));
billingRouter.post('/create-subscription', authMiddleware, (req, res) => billingController.createMpSubscription(req, res));
billingRouter.post('/cancel', authMiddleware, (req, res) => billingController.cancelSubscription(req, res));
billingRouter.post('/check-limits', authMiddleware, (req, res) => billingController.checkLimits(req, res));

// Public endpoint (called by MercadoPago)
billingRouter.post('/webhook', (req, res) => billingController.handleWebhook(req as any, res));
