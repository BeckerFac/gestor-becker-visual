import axios, { AxiosInstance } from 'axios';
import { ApiError } from '../../middlewares/errorHandler';
import { billingService } from './billing.service';
import { getPlan } from './plans.config';

// MercadoPago Subscriptions API integration
// Docs: https://www.mercadopago.com.ar/developers/es/docs/subscriptions/landing
//
// Flow:
// 1. Frontend calls POST /api/billing/create-subscription with planId
// 2. Backend creates a MercadoPago preapproval (subscription)
// 3. Returns init_point URL -> user redirected to MercadoPago checkout
// 4. User pays -> MercadoPago sends webhook to POST /api/billing/webhook
// 5. Backend processes webhook, updates subscription status
//
// Environment variables needed:
//   MERCADOPAGO_ACCESS_TOKEN - Production access token
//   MERCADOPAGO_WEBHOOK_SECRET - Webhook signature secret
//   APP_URL - Public URL for webhooks (e.g., https://gestor.beckervisual.com)

interface MercadoPagoConfig {
  accessToken: string;
  webhookSecret: string;
  appUrl: string;
}

interface CreateSubscriptionResult {
  init_point: string;
  subscription_id: string;
}

interface WebhookPayload {
  id: string;
  type: string;
  action: string;
  data: {
    id: string;
  };
}

class MercadoPagoService {
  private client: AxiosInstance | null = null;

  private getConfig(): MercadoPagoConfig {
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN || '';
    const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET || '';
    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    return { accessToken, webhookSecret, appUrl };
  }

  private getClient(): AxiosInstance {
    if (this.client) return this.client;

    const config = this.getConfig();
    if (!config.accessToken) {
      throw new ApiError(503, 'MercadoPago no esta configurado. Configure MERCADOPAGO_ACCESS_TOKEN.');
    }

    this.client = axios.create({
      baseURL: 'https://api.mercadopago.com',
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    return this.client;
  }

  // Check if MercadoPago is configured
  isConfigured(): boolean {
    const config = this.getConfig();
    return !!config.accessToken;
  }

  // Create a subscription (preapproval) for a company
  // MercadoPago Preapproval API: POST /preapproval
  async createSubscription(
    companyId: string,
    planId: string,
    payerEmail: string
  ): Promise<CreateSubscriptionResult> {
    const plan = getPlan(planId);
    if (!plan || planId === 'trial') {
      throw new ApiError(400, 'Plan no valido');
    }

    const config = this.getConfig();
    const client = this.getClient();

    try {
      // Create preapproval (recurring subscription)
      // Docs: https://www.mercadopago.com.ar/developers/es/reference/subscriptions/_preapproval/post
      const response = await client.post('/preapproval', {
        reason: `Gestor BeckerVisual - Plan ${plan.displayName}`,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: plan.priceArs,
          currency_id: 'ARS',
        },
        payer_email: payerEmail,
        back_url: `${config.appUrl}/settings?billing=success`,
        external_reference: `${companyId}:${planId}`,
        notification_url: `${config.appUrl}/api/billing/webhook`,
        status: 'pending',
      });

      const mpSubscription = response.data;

      return {
        init_point: mpSubscription.init_point,
        subscription_id: mpSubscription.id,
      };
    } catch (error: any) {
      console.error('MercadoPago create subscription error:', error.response?.data || error.message);
      throw new ApiError(502, 'Error al crear suscripcion en MercadoPago');
    }
  }

  // Handle webhook notification from MercadoPago
  // Webhook types: subscription_preapproval, payment
  async handleWebhook(payload: WebhookPayload): Promise<void> {
    if (!payload?.type || !payload?.data?.id) {
      console.warn('Invalid webhook payload:', payload);
      return;
    }

    const client = this.getClient();

    try {
      switch (payload.type) {
        case 'subscription_preapproval': {
          // Fetch subscription details from MercadoPago
          const response = await client.get(`/preapproval/${payload.data.id}`);
          const mpSub = response.data;

          const externalRef = mpSub.external_reference || '';
          const [companyId, planId] = externalRef.split(':');

          if (!companyId) {
            console.warn('Webhook: No company_id in external_reference:', externalRef);
            return;
          }

          switch (mpSub.status) {
            case 'authorized':
            case 'active':
              // Subscription activated - upgrade the plan
              await billingService.upgradePlan(companyId, planId || 'starter', {
                provider: 'mercadopago',
                providerSubscriptionId: mpSub.id,
              });
              console.log(`Subscription activated: company=${companyId} plan=${planId}`);
              break;

            case 'paused':
            case 'pending':
              // Payment pending - mark as past_due
              await billingService.markPastDue(companyId);
              console.log(`Subscription paused/pending: company=${companyId}`);
              break;

            case 'cancelled':
              // Subscription cancelled by user or MP
              await billingService.cancelSubscription(companyId);
              console.log(`Subscription cancelled: company=${companyId}`);
              break;
          }
          break;
        }

        case 'payment': {
          // Individual payment notification
          const paymentResponse = await client.get(`/v1/payments/${payload.data.id}`);
          const payment = paymentResponse.data;

          const externalRef = payment.external_reference || '';
          const [companyId] = externalRef.split(':');

          if (!companyId) return;

          if (payment.status === 'approved') {
            // Payment successful - renew subscription
            await billingService.renewSubscription(companyId);
            console.log(`Payment approved: company=${companyId} amount=${payment.transaction_amount}`);
          } else if (payment.status === 'rejected' || payment.status === 'cancelled') {
            // Payment failed
            await billingService.markPastDue(companyId);
            console.log(`Payment failed: company=${companyId} status=${payment.status}`);
          }
          break;
        }

        default:
          console.log(`Unhandled webhook type: ${payload.type}`);
      }
    } catch (error: any) {
      console.error('MercadoPago webhook processing error:', error.message);
      // Don't throw - we always want to return 200 to MercadoPago
    }
  }

  // Cancel a subscription in MercadoPago
  async cancelMpSubscription(mpSubscriptionId: string): Promise<void> {
    if (!mpSubscriptionId) return;

    try {
      const client = this.getClient();
      await client.put(`/preapproval/${mpSubscriptionId}`, {
        status: 'cancelled',
      });
    } catch (error: any) {
      console.error('MercadoPago cancel subscription error:', error.response?.data || error.message);
      // Don't throw - local cancellation should still work
    }
  }

  // Validate webhook signature (HMAC)
  // TODO: Implement proper signature validation when deploying
  // MercadoPago sends x-signature header with HMAC-SHA256
  validateWebhookSignature(
    _headers: Record<string, string>,
    _body: string
  ): boolean {
    const config = this.getConfig();
    if (!config.webhookSecret) {
      // If no secret configured, accept all webhooks (dev mode)
      console.warn('WARNING: MERCADOPAGO_WEBHOOK_SECRET not set, skipping signature validation');
      return true;
    }

    // TODO: Implement HMAC validation
    // const signature = headers['x-signature'];
    // const requestId = headers['x-request-id'];
    // ... validate using crypto.createHmac('sha256', config.webhookSecret)
    return true;
  }
}

export const mercadoPagoService = new MercadoPagoService();
