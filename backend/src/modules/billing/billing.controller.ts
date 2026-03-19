import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import { ApiError } from '../../middlewares/errorHandler';
import { billingService } from './billing.service';
import { mercadoPagoService } from './mercadopago.service';

export class BillingController {
  // GET /api/billing/subscription - Get current subscription
  async getSubscription(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const subscription = await billingService.getSubscription(req.user.company_id);
      res.json(subscription);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Get subscription error:', error);
      res.status(500).json({ error: 'Error al obtener suscripcion' });
    }
  }

  // GET /api/billing/plans - Get available plans
  async getPlans(_req: AuthRequest, res: Response) {
    try {
      const plans = billingService.getPlans();
      res.json({ plans });
    } catch (error) {
      res.status(500).json({ error: 'Error al obtener planes' });
    }
  }

  // GET /api/billing/usage - Get usage for current month
  async getUsage(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');
      const usage = await billingService.getUsage(req.user.company_id);
      const subscription = await billingService.getSubscription(req.user.company_id);
      res.json({
        usage,
        limits: subscription.plan_details.limits,
        plan: subscription.plan_details.displayName,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al obtener uso' });
    }
  }

  // POST /api/billing/create-subscription - Start MercadoPago subscription
  async createMpSubscription(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');

      const { plan_id } = req.body;
      if (!plan_id) throw new ApiError(400, 'plan_id es requerido');

      if (!mercadoPagoService.isConfigured()) {
        throw new ApiError(503, 'MercadoPago no esta configurado en este entorno');
      }

      const result = await mercadoPagoService.createSubscription(
        req.user.company_id,
        plan_id,
        req.user.email
      );

      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Create MP subscription error:', error);
      res.status(500).json({ error: 'Error al crear suscripcion' });
    }
  }

  // POST /api/billing/webhook - MercadoPago webhook endpoint
  // This endpoint does NOT require authentication (called by MercadoPago)
  async handleWebhook(req: AuthRequest, res: Response) {
    try {
      // Validate webhook signature
      const isValid = mercadoPagoService.validateWebhookSignature(
        req.headers as Record<string, string>,
        JSON.stringify(req.body)
      );

      if (!isValid) {
        console.warn('Invalid webhook signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Process webhook asynchronously but respond immediately
      const payload = req.body;
      await mercadoPagoService.handleWebhook(payload);

      // Always respond 200 to MercadoPago
      res.status(200).json({ received: true });
    } catch (error) {
      console.error('Webhook error:', error);
      // Still respond 200 to avoid retries
      res.status(200).json({ received: true });
    }
  }

  // POST /api/billing/cancel - Cancel subscription
  async cancelSubscription(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');

      // Get current subscription to find MP subscription ID
      const current = await billingService.getSubscription(req.user.company_id);

      // Cancel in MercadoPago if applicable
      if (current.payment_provider_subscription_id) {
        await mercadoPagoService.cancelMpSubscription(current.payment_provider_subscription_id);
      }

      // Cancel locally
      const subscription = await billingService.cancelSubscription(req.user.company_id);
      res.json(subscription);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Cancel subscription error:', error);
      res.status(500).json({ error: 'Error al cancelar suscripcion' });
    }
  }

  // POST /api/billing/check-limits - Check if action is allowed
  async checkLimits(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.company_id) throw new ApiError(401, 'Unauthorized');

      const { action } = req.body;
      if (!action) throw new ApiError(400, 'action es requerido');

      const result = await billingService.checkLimits(req.user.company_id, action);
      res.json(result);
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: 'Error al verificar limites' });
    }
  }
}

export const billingController = new BillingController();
