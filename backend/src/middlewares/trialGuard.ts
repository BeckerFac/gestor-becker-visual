import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { db } from '../config/db';
import { sql } from 'drizzle-orm';
import { ApiError } from './errorHandler';

export interface SubscriptionInfo {
  subscription_status: string;
  trial_ends_at: string | null;
  grace_ends_at: string | null;
  days_remaining: number;
  is_read_only: boolean;
}

// Calculates the current subscription state (handles automatic transitions)
async function getSubscriptionInfo(companyId: string): Promise<SubscriptionInfo> {
  const result = await db.execute(sql`
    SELECT subscription_status, trial_ends_at, grace_ends_at
    FROM companies
    WHERE id = ${companyId}
  `);

  const rows = (result as any).rows || result || [];
  if (rows.length === 0) {
    throw new ApiError(404, 'Company not found');
  }

  const company = rows[0] as {
    subscription_status: string;
    trial_ends_at: string | null;
    grace_ends_at: string | null;
  };

  const now = new Date();
  let status = company.subscription_status || 'trial';
  let daysRemaining = 0;
  let isReadOnly = false;

  if (status === 'active') {
    // Paid plan - full access
    daysRemaining = -1; // unlimited
  } else if (status === 'trial') {
    if (company.trial_ends_at) {
      const trialEnd = new Date(company.trial_ends_at);
      daysRemaining = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysRemaining <= 0) {
        // Trial expired -> move to grace period
        const graceEnd = new Date(trialEnd.getTime() + 3 * 24 * 60 * 60 * 1000);
        const graceDays = Math.ceil((graceEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (graceDays > 0) {
          status = 'grace';
          isReadOnly = true;
          daysRemaining = graceDays;

          // Auto-transition to grace in DB
          await db.execute(sql`
            UPDATE companies
            SET subscription_status = 'grace', grace_ends_at = ${graceEnd.toISOString()}
            WHERE id = ${companyId} AND subscription_status = 'trial'
          `);
        } else {
          // Grace also expired
          status = 'expired';
          isReadOnly = true;
          daysRemaining = 0;

          await db.execute(sql`
            UPDATE companies
            SET subscription_status = 'expired'
            WHERE id = ${companyId} AND subscription_status IN ('trial', 'grace')
          `);
        }
      }
    }
  } else if (status === 'grace') {
    if (company.grace_ends_at) {
      const graceEnd = new Date(company.grace_ends_at);
      daysRemaining = Math.ceil((graceEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      isReadOnly = true;

      if (daysRemaining <= 0) {
        status = 'expired';
        daysRemaining = 0;

        await db.execute(sql`
          UPDATE companies
          SET subscription_status = 'expired'
          WHERE id = ${companyId} AND subscription_status = 'grace'
        `);
      }
    }
  } else if (status === 'expired' || status === 'cancelled') {
    isReadOnly = true;
    daysRemaining = 0;
  }

  return {
    subscription_status: status,
    trial_ends_at: company.trial_ends_at,
    grace_ends_at: company.grace_ends_at,
    days_remaining: Math.max(0, daysRemaining),
    is_read_only: isReadOnly,
  };
}

// Middleware: blocks write operations (POST/PUT/DELETE) when in read-only mode
export const trialWriteGuard = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.company_id) {
      return next();
    }

    // Only block write operations
    const isWriteOperation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (!isWriteOperation) {
      return next();
    }

    const info = await getSubscriptionInfo(req.user.company_id);

    if (info.is_read_only) {
      throw new ApiError(
        403,
        `Su cuenta esta en modo solo lectura (${info.subscription_status === 'grace' ? 'periodo de gracia' : 'plan expirado'}). Actualice su plan para continuar operando.`
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};

// Endpoint handler to return subscription info
export async function getSubscriptionStatus(companyId: string): Promise<SubscriptionInfo> {
  return getSubscriptionInfo(companyId);
}
