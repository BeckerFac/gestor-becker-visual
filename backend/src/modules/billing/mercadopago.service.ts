import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
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
      // Determine frequency based on billing period
      const isAnnual = plan.billingPeriod === 'annual';
      const frequency = isAnnual ? 12 : 1;
      const frequencyType = 'months';
      // For annual plans, charge the full annual price upfront
      const transactionAmount = isAnnual ? plan.priceArs : plan.priceArs;

      // Create preapproval (recurring subscription)
      // Docs: https://www.mercadopago.com.ar/developers/es/reference/subscriptions/_preapproval/post
      const response = await client.post('/preapproval', {
        reason: `Gestor BeckerVisual - Plan ${plan.displayName} (${isAnnual ? 'Anual' : 'Mensual'})`,
        auto_recurring: {
          frequency,
          frequency_type: frequencyType,
          transaction_amount: transactionAmount,
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

  // Validate webhook signature (HMAC-SHA256)
  // MercadoPago sends x-signature header in format: ts=<timestamp>,v1=<hash>
  // The hash is HMAC-SHA256(secret, "id:<data.id>;request-id:<x-request-id>;ts:<timestamp>;")
  validateWebhookSignature(
    headers: Record<string, string>,
    _body: string
  ): boolean {
    const config = this.getConfig();
    if (!config.webhookSecret) {
      // SECURITY: In production, reject all webhooks if no secret is configured
      if (process.env.NODE_ENV === 'production') {
        console.error('SECURITY: MERCADOPAGO_WEBHOOK_SECRET not set in production - rejecting webhook');
        return false;
      }
      console.warn('WARNING: MERCADOPAGO_WEBHOOK_SECRET not set, skipping signature validation (dev mode only)');
      return true;
    }

    const xSignature = headers['x-signature'] || '';
    const xRequestId = headers['x-request-id'] || '';

    if (!xSignature) {
      console.warn('Webhook missing x-signature header');
      return false;
    }

    // Parse x-signature: ts=<timestamp>,v1=<hash>
    const parts: Record<string, string> = {};
    for (const part of xSignature.split(',')) {
      const [key, ...valueParts] = part.trim().split('=');
      if (key && valueParts.length > 0) {
        parts[key] = valueParts.join('=');
      }
    }

    const ts = parts['ts'];
    const receivedHash = parts['v1'];

    if (!ts || !receivedHash) {
      console.warn('Webhook x-signature missing ts or v1 components');
      return false;
    }

    // Reject signatures older than 5 minutes to prevent replay attacks
    const signatureAge = Math.abs(Date.now() / 1000 - parseInt(ts, 10));
    if (signatureAge > 300) {
      console.warn(`Webhook signature too old: ${signatureAge}s`);
      return false;
    }

    // Parse the body to extract data.id
    let dataId = '';
    try {
      const parsed = JSON.parse(_body);
      dataId = parsed?.data?.id || '';
    } catch {
      console.warn('Webhook body is not valid JSON');
      return false;
    }

    // Build the manifest string per MercadoPago docs
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

    // Compute HMAC-SHA256
    const expectedHash = crypto
      .createHmac('sha256', config.webhookSecret)
      .update(manifest)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(receivedHash, 'hex'),
        Buffer.from(expectedHash, 'hex')
      );
    } catch {
      return false;
    }
  }
}

export const mercadoPagoService = new MercadoPagoService();
