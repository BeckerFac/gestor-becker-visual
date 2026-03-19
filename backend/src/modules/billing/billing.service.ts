import { db, pool } from '../../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../middlewares/errorHandler';
import { getPlan, PLANS, TRIAL_DURATION_DAYS, PlanDefinition } from './plans.config';

export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired';

export interface Subscription {
  id: string;
  company_id: string;
  plan: string;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  payment_provider: string | null;
  payment_provider_subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UsageTracking {
  id: string;
  company_id: string;
  month: string;
  invoices_count: number;
  orders_count: number;
  users_count: number;
  storage_mb: number;
}

export interface UsageSummary {
  invoices_count: number;
  orders_count: number;
  users_count: number;
  total_documents: number;
  storage_mb: number;
}

export interface SubscriptionWithPlan extends Subscription {
  plan_details: PlanDefinition;
  usage: UsageSummary;
  days_remaining: number | null;
  is_trial: boolean;
  can_use: boolean;
}

export type UsageAction = 'invoice' | 'order' | 'quote' | 'user';

class BillingService {
  private migrationsRun = false;

  async ensureMigrations(): Promise<void> {
    if (this.migrationsRun) return;
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          plan VARCHAR(50) NOT NULL DEFAULT 'trial',
          status VARCHAR(50) NOT NULL DEFAULT 'trial',
          trial_ends_at TIMESTAMP WITH TIME ZONE,
          current_period_start TIMESTAMP WITH TIME ZONE,
          current_period_end TIMESTAMP WITH TIME ZONE,
          payment_provider VARCHAR(50),
          payment_provider_subscription_id VARCHAR(255),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(company_id)
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS usage_tracking (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          month VARCHAR(7) NOT NULL,
          invoices_count INTEGER DEFAULT 0,
          orders_count INTEGER DEFAULT 0,
          users_count INTEGER DEFAULT 0,
          storage_mb DECIMAL(10,2) DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(company_id, month)
        )
      `);

      await pool.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_company ON subscriptions(company_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_usage_tracking_company_month ON usage_tracking(company_id, month)`);

      this.migrationsRun = true;
    } catch (error) {
      console.error('Billing migrations error:', error);
    }
  }

  // Get the current month key (YYYY-MM)
  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  // Get or create subscription for a company
  async getSubscription(companyId: string): Promise<SubscriptionWithPlan> {
    await this.ensureMigrations();

    const result = await db.execute(sql`
      SELECT * FROM subscriptions WHERE company_id = ${companyId}
    `);
    const rows = (result as any).rows || result || [];

    let subscription: Subscription;

    if (rows.length === 0) {
      // Auto-create trial subscription
      subscription = await this.createTrialSubscription(companyId);
    } else {
      subscription = rows[0] as Subscription;
    }

    // Check if trial has expired
    if (subscription.status === 'trial' && subscription.trial_ends_at) {
      const trialEnd = new Date(subscription.trial_ends_at);
      if (trialEnd < new Date()) {
        await db.execute(sql`
          UPDATE subscriptions SET status = 'expired', updated_at = NOW()
          WHERE company_id = ${companyId}
        `);
        subscription = { ...subscription, status: 'expired' };
      }
    }

    // Check if active subscription period has ended
    if (subscription.status === 'active' && subscription.current_period_end) {
      const periodEnd = new Date(subscription.current_period_end);
      if (periodEnd < new Date()) {
        await db.execute(sql`
          UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
          WHERE company_id = ${companyId}
        `);
        subscription = { ...subscription, status: 'past_due' };
      }
    }

    const planDetails = getPlan(subscription.plan);
    const usage = await this.getUsage(companyId);

    let daysRemaining: number | null = null;
    if (subscription.status === 'trial' && subscription.trial_ends_at) {
      const trialEnd = new Date(subscription.trial_ends_at);
      const now = new Date();
      daysRemaining = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    } else if (subscription.status === 'active' && subscription.current_period_end) {
      const periodEnd = new Date(subscription.current_period_end);
      const now = new Date();
      daysRemaining = Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    }

    const canUse = subscription.status === 'trial' || subscription.status === 'active';

    return {
      ...subscription,
      plan_details: planDetails,
      usage,
      days_remaining: daysRemaining,
      is_trial: subscription.status === 'trial',
      can_use: canUse,
    };
  }

  // Create a trial subscription for a new company
  async createTrialSubscription(companyId: string): Promise<Subscription> {
    await this.ensureMigrations();

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DURATION_DAYS);

    const result = await db.execute(sql`
      INSERT INTO subscriptions (company_id, plan, status, trial_ends_at)
      VALUES (${companyId}, 'trial', 'trial', ${trialEndsAt.toISOString()})
      ON CONFLICT (company_id) DO NOTHING
      RETURNING *
    `);
    const rows = (result as any).rows || result || [];

    if (rows.length === 0) {
      // Subscription already exists, return it
      const existing = await db.execute(sql`
        SELECT * FROM subscriptions WHERE company_id = ${companyId}
      `);
      return ((existing as any).rows || existing || [])[0] as Subscription;
    }

    return rows[0] as Subscription;
  }

  // Upgrade plan (called after successful payment)
  async upgradePlan(
    companyId: string,
    planId: string,
    paymentData?: {
      provider?: string;
      providerSubscriptionId?: string;
    }
  ): Promise<Subscription> {
    await this.ensureMigrations();

    const plan = getPlan(planId);
    if (!plan || planId === 'trial') {
      throw new ApiError(400, 'Plan no valido');
    }

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const result = await db.execute(sql`
      UPDATE subscriptions SET
        plan = ${planId},
        status = 'active',
        current_period_start = ${now.toISOString()},
        current_period_end = ${periodEnd.toISOString()},
        payment_provider = ${paymentData?.provider || 'mercadopago'},
        payment_provider_subscription_id = ${paymentData?.providerSubscriptionId || null},
        trial_ends_at = NULL,
        updated_at = NOW()
      WHERE company_id = ${companyId}
      RETURNING *
    `);
    const rows = (result as any).rows || result || [];

    if (rows.length === 0) {
      throw new ApiError(404, 'Suscripcion no encontrada');
    }

    return rows[0] as Subscription;
  }

  // Cancel subscription (keeps access until period end)
  async cancelSubscription(companyId: string): Promise<Subscription> {
    await this.ensureMigrations();

    const result = await db.execute(sql`
      UPDATE subscriptions SET
        status = 'cancelled',
        updated_at = NOW()
      WHERE company_id = ${companyId}
      RETURNING *
    `);
    const rows = (result as any).rows || result || [];

    if (rows.length === 0) {
      throw new ApiError(404, 'Suscripcion no encontrada');
    }

    return rows[0] as Subscription;
  }

  // Renew subscription (called by webhook on successful recurring payment)
  async renewSubscription(companyId: string): Promise<Subscription> {
    await this.ensureMigrations();

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const result = await db.execute(sql`
      UPDATE subscriptions SET
        status = 'active',
        current_period_start = ${now.toISOString()},
        current_period_end = ${periodEnd.toISOString()},
        updated_at = NOW()
      WHERE company_id = ${companyId}
      RETURNING *
    `);
    const rows = (result as any).rows || result || [];

    if (rows.length === 0) {
      throw new ApiError(404, 'Suscripcion no encontrada');
    }

    return rows[0] as Subscription;
  }

  // Mark subscription as past_due (payment failed)
  async markPastDue(companyId: string): Promise<void> {
    await this.ensureMigrations();

    await db.execute(sql`
      UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
      WHERE company_id = ${companyId}
    `);
  }

  // Get usage for current month
  async getUsage(companyId: string): Promise<UsageSummary> {
    await this.ensureMigrations();

    const month = this.getCurrentMonth();

    const result = await db.execute(sql`
      SELECT * FROM usage_tracking
      WHERE company_id = ${companyId} AND month = ${month}
    `);
    const rows = (result as any).rows || result || [];

    if (rows.length === 0) {
      return {
        invoices_count: 0,
        orders_count: 0,
        users_count: 0,
        total_documents: 0,
        storage_mb: 0,
      };
    }

    const row = rows[0];
    const invoicesCount = parseInt(row.invoices_count) || 0;
    const ordersCount = parseInt(row.orders_count) || 0;

    return {
      invoices_count: invoicesCount,
      orders_count: ordersCount,
      users_count: parseInt(row.users_count) || 0,
      total_documents: invoicesCount + ordersCount,
      storage_mb: parseFloat(row.storage_mb) || 0,
    };
  }

  // Track a usage action
  async trackUsage(companyId: string, action: UsageAction): Promise<void> {
    await this.ensureMigrations();

    const month = this.getCurrentMonth();

    // Upsert the usage record
    let column: string;
    switch (action) {
      case 'invoice':
      case 'quote':
        column = 'invoices_count';
        break;
      case 'order':
        column = 'orders_count';
        break;
      case 'user':
        column = 'users_count';
        break;
      default:
        return;
    }

    await db.execute(sql`
      INSERT INTO usage_tracking (company_id, month)
      VALUES (${companyId}, ${month})
      ON CONFLICT (company_id, month) DO NOTHING
    `);

    // Use raw SQL for dynamic column increment
    await pool.query(
      `UPDATE usage_tracking SET ${column} = ${column} + 1 WHERE company_id = $1 AND month = $2`,
      [companyId, month]
    );
  }

  // Check if a company can perform an action based on plan limits
  async checkLimits(companyId: string, action: UsageAction): Promise<{
    allowed: boolean;
    current: number;
    limit: number;
    message: string | null;
  }> {
    await this.ensureMigrations();

    const subscriptionData = await this.getSubscription(companyId);

    // If subscription is not usable
    if (!subscriptionData.can_use) {
      if (subscriptionData.status === 'expired') {
        return {
          allowed: false,
          current: 0,
          limit: 0,
          message: 'Tu periodo de prueba expiro. Elegí un plan para continuar usando el sistema.',
        };
      }
      if (subscriptionData.status === 'past_due') {
        return {
          allowed: false,
          current: 0,
          limit: 0,
          message: 'Tu suscripcion tiene un pago pendiente. Actualizá tu medio de pago para continuar.',
        };
      }
      if (subscriptionData.status === 'cancelled') {
        return {
          allowed: false,
          current: 0,
          limit: 0,
          message: 'Tu suscripcion fue cancelada. Reactivá tu plan para seguir usando el sistema.',
        };
      }
    }

    const { limits } = subscriptionData.plan_details;
    const usage = subscriptionData.usage;

    switch (action) {
      case 'invoice':
      case 'quote': {
        const current = usage.total_documents;
        const limit = limits.invoicesPerMonth;
        if (limit !== Infinity && current >= limit) {
          return {
            allowed: false,
            current,
            limit,
            message: `Alcanzaste el limite de ${limit} comprobantes/mes de tu plan ${subscriptionData.plan_details.displayName}. Upgrade para continuar.`,
          };
        }
        return { allowed: true, current, limit, message: null };
      }
      case 'order': {
        const current = usage.total_documents;
        const limit = limits.invoicesPerMonth;
        if (limit !== Infinity && current >= limit) {
          return {
            allowed: false,
            current,
            limit,
            message: `Alcanzaste el limite de ${limit} comprobantes/mes de tu plan ${subscriptionData.plan_details.displayName}. Upgrade para continuar.`,
          };
        }
        return { allowed: true, current, limit, message: null };
      }
      case 'user': {
        const current = usage.users_count;
        const limit = limits.usersMax;
        if (limit !== Infinity && current >= limit) {
          return {
            allowed: false,
            current,
            limit,
            message: `Alcanzaste el limite de ${limit} usuarios de tu plan ${subscriptionData.plan_details.displayName}. Upgrade para agregar mas usuarios.`,
          };
        }
        return { allowed: true, current, limit, message: null };
      }
      default:
        return { allowed: true, current: 0, limit: Infinity, message: null };
    }
  }

  // Get all plans for display
  getPlans(): ReadonlyArray<PlanDefinition> {
    return Object.values(PLANS)
      .filter(p => p.id !== 'trial')
      .sort((a, b) => a.order - b.order);
  }
}

export const billingService = new BillingService();
