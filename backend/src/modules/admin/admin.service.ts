import { db, pool, exportCompanyData } from '../../config/db';
import { sql } from 'drizzle-orm';
import { env } from '../../config/env';
import { ApiError } from '../../middlewares/errorHandler';
import { PLANS, getPlan, TRIAL_DURATION_DAYS } from '../billing/plans.config';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Block reason categories
export const BLOCK_REASON_CATEGORIES = [
  'no_pago',
  'abuso',
  'solicitud_cliente',
  'otro',
] as const;
export type BlockReasonCategory = typeof BLOCK_REASON_CATEGORIES[number];

export class AdminService {
  /**
   * List all companies with aggregated stats, supporting search/filter/sort.
   */
  async getAllCompanies(options?: {
    search?: string;
    planFilter?: string;
    statusFilter?: string;
    sortBy?: string;
    sortDir?: string;
  }) {
    const { search, planFilter, statusFilter, sortBy, sortDir } = options || {};

    let query = `
      SELECT
        c.id,
        c.name,
        c.cuit,
        c.onboarding_completed,
        c.created_at,
        c.updated_at,
        c.enabled_modules,
        c.subscription_status,
        c.subscription_plan,
        c.trial_ends_at,
        c.blocked,
        c.block_reason,
        c.block_reason_category,
        c.blocked_at,
        c.billing_period,
        c.plan_overrides,
        c.trial_extended_days,
        COALESCE(u_count.cnt, 0) AS users_count,
        u_count.last_activity,
        COALESCE(inv_count.cnt, 0) AS invoices_count_this_month,
        s.plan AS sub_plan,
        s.status AS sub_status,
        s.current_period_start,
        s.current_period_end
      FROM companies c
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS cnt,
          MAX(GREATEST(u.last_login, u.updated_at)) AS last_activity
        FROM users u
        WHERE u.company_id = c.id
      ) u_count ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt
        FROM invoices i
        WHERE i.company_id = c.id
          AND i.created_at >= date_trunc('month', NOW())
      ) inv_count ON true
      LEFT JOIN subscriptions s ON s.company_id = c.id
    `;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(c.name ILIKE $${paramIdx} OR c.cuit ILIKE $${paramIdx} OR EXISTS (SELECT 1 FROM users u2 WHERE u2.company_id = c.id AND u2.email ILIKE $${paramIdx}))`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (planFilter && planFilter !== 'all') {
      conditions.push(`(c.subscription_plan ILIKE $${paramIdx} OR s.plan ILIKE $${paramIdx})`);
      params.push(`%${planFilter}%`);
      paramIdx++;
    }

    if (statusFilter && statusFilter !== 'all') {
      if (statusFilter === 'blocked') {
        conditions.push(`c.blocked = true`);
      } else {
        conditions.push(`c.subscription_status = $${paramIdx} AND (c.blocked = false OR c.blocked IS NULL)`);
        params.push(statusFilter);
        paramIdx++;
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    // Sorting
    const sortColumn = (() => {
      switch (sortBy) {
        case 'last_activity': return 'u_count.last_activity';
        case 'revenue': return 'inv_count.cnt';
        case 'name': return 'c.name';
        case 'users_count': return 'u_count.cnt';
        default: return 'c.created_at';
      }
    })();
    const direction = sortDir === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortColumn} ${direction} NULLS LAST`;

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Get full detail for a single company including its users and usage stats.
   */
  async getCompanyDetail(companyId: string) {
    // Company info
    const companyResult = await pool.query(
      `SELECT * FROM companies WHERE id = $1`,
      [companyId]
    );
    if (companyResult.rows.length === 0) {
      throw new ApiError(404, 'Company not found');
    }
    const company = companyResult.rows[0];

    // Users
    const usersResult = await pool.query(
      `SELECT id, email, name, role, active, last_login, created_at
       FROM users
       WHERE company_id = $1
       ORDER BY created_at ASC`,
      [companyId]
    );

    // Usage stats
    const statsResult = await pool.query(
      `SELECT
        (SELECT COUNT(*)::int FROM products WHERE company_id = $1) AS products_count,
        (SELECT COUNT(*)::int FROM customers WHERE company_id = $1) AS customers_count,
        (SELECT COUNT(*)::int FROM invoices WHERE company_id = $1) AS total_invoices,
        (SELECT COUNT(*)::int FROM invoices WHERE company_id = $1 AND created_at >= date_trunc('month', NOW())) AS invoices_this_month,
        (SELECT COUNT(*)::int FROM orders WHERE company_id = $1) AS total_orders,
        (SELECT COALESCE(SUM(total_amount), 0)::numeric FROM invoices WHERE company_id = $1 AND status = 'authorized') AS total_revenue`,
      [companyId]
    );
    const stats = statsResult.rows[0] || {};

    // Subscription info
    const subResult = await pool.query(
      `SELECT * FROM subscriptions WHERE company_id = $1`,
      [companyId]
    );
    const subscription = subResult.rows[0] || null;

    // Audit trail (last 20 entries)
    const auditResult = await pool.query(
      `SELECT al.*, u.email as user_email, u.name as user_name
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE al.company_id = $1
       ORDER BY al.created_at DESC
       LIMIT 20`,
      [companyId]
    );

    return {
      company,
      users: usersResult.rows,
      stats,
      subscription,
      audit_trail: auditResult.rows,
    };
  }

  /**
   * Block a company with categorized reason.
   */
  async blockCompany(
    companyId: string,
    category: BlockReasonCategory,
    reason: string,
    superadminUserId: string
  ) {
    const check = await pool.query(`SELECT id, name FROM companies WHERE id = $1`, [companyId]);
    if (check.rows.length === 0) {
      throw new ApiError(404, 'Company not found');
    }

    if (!BLOCK_REASON_CATEGORIES.includes(category)) {
      throw new ApiError(400, `Invalid block category. Must be one of: ${BLOCK_REASON_CATEGORIES.join(', ')}`);
    }

    if (!reason || reason.trim().length < 3) {
      throw new ApiError(400, 'Block reason must be at least 3 characters');
    }

    // Block company
    await pool.query(
      `UPDATE companies SET
        blocked = true,
        block_reason = $2,
        block_reason_category = $3,
        blocked_at = NOW(),
        blocked_by = $4,
        updated_at = NOW()
       WHERE id = $1`,
      [companyId, reason.trim(), category, superadminUserId]
    );

    // Deactivate all users
    await pool.query(
      `UPDATE users SET active = false, updated_at = NOW() WHERE company_id = $1`,
      [companyId]
    );

    // Audit log
    await pool.query(
      `INSERT INTO audit_log (company_id, user_id, action, resource, new_values)
       VALUES ($1, $2, 'company_blocked', 'company', $3::jsonb)`,
      [companyId, superadminUserId, JSON.stringify({ category, reason: reason.trim() })]
    );

    return {
      success: true,
      message: `Company ${check.rows[0].name} blocked. Category: ${category}. Reason: ${reason.trim()}`,
    };
  }

  /**
   * Unblock a company and reactivate all users.
   */
  async unblockCompany(companyId: string, superadminUserId: string) {
    const check = await pool.query(`SELECT id, name FROM companies WHERE id = $1`, [companyId]);
    if (check.rows.length === 0) {
      throw new ApiError(404, 'Company not found');
    }

    await pool.query(
      `UPDATE companies SET
        blocked = false,
        block_reason = NULL,
        block_reason_category = NULL,
        blocked_at = NULL,
        blocked_by = NULL,
        updated_at = NOW()
       WHERE id = $1`,
      [companyId]
    );

    await pool.query(
      `UPDATE users SET active = true, updated_at = NOW() WHERE company_id = $1`,
      [companyId]
    );

    await pool.query(
      `INSERT INTO audit_log (company_id, user_id, action, resource)
       VALUES ($1, $2, 'company_unblocked', 'company')`,
      [companyId, superadminUserId]
    );

    return { success: true, message: `Company ${check.rows[0].name} unblocked` };
  }

  /**
   * LEGACY: Disable a company (set all users to inactive + log reason).
   * Kept for backwards compatibility, delegates to blockCompany.
   */
  async disableCompany(companyId: string, reason: string) {
    // Verify company exists
    const check = await db.execute(sql`SELECT id FROM companies WHERE id = ${companyId}`);
    const checkRows = (check as any).rows || check || [];
    if (checkRows.length === 0) {
      throw new ApiError(404, 'Company not found');
    }

    // Deactivate all users
    await db.execute(sql`
      UPDATE users SET active = false, updated_at = NOW() WHERE company_id = ${companyId}
    `);

    // Log in audit_log
    await db.execute(sql`
      INSERT INTO audit_log (company_id, action, resource, new_values)
      VALUES (${companyId}, 'company_disabled', 'company', ${JSON.stringify({ reason })}::jsonb)
    `);

    return { success: true, message: `Company ${companyId} disabled. Reason: ${reason}` };
  }

  /**
   * LEGACY: Re-enable a company (reactivate all users).
   * Kept for backwards compatibility, delegates to unblockCompany.
   */
  async enableCompany(companyId: string) {
    const check = await db.execute(sql`SELECT id FROM companies WHERE id = ${companyId}`);
    const checkRows = (check as any).rows || check || [];
    if (checkRows.length === 0) {
      throw new ApiError(404, 'Company not found');
    }

    await db.execute(sql`
      UPDATE users SET active = true, updated_at = NOW() WHERE company_id = ${companyId}
    `);

    await db.execute(sql`
      INSERT INTO audit_log (company_id, action, resource)
      VALUES (${companyId}, 'company_enabled', 'company')
    `);

    return { success: true, message: `Company ${companyId} re-enabled` };
  }

  /**
   * Generate a temporary read-only impersonation token for a company.
   */
  async impersonateCompany(companyId: string, superadminUserId: string) {
    const userResult = await db.execute(sql`
      SELECT u.id, u.email, u.name, u.role, u.company_id, c.name AS company_name, c.cuit
      FROM users u
      JOIN companies c ON c.id = u.company_id
      WHERE u.company_id = ${companyId} AND u.role = 'admin'
      ORDER BY u.created_at ASC
      LIMIT 1
    `);
    let userRows = (userResult as any).rows || userResult || [];

    if (userRows.length === 0) {
      const fallback = await db.execute(sql`
        SELECT u.id, u.email, u.name, u.role, u.company_id, c.name AS company_name, c.cuit
        FROM users u
        JOIN companies c ON c.id = u.company_id
        WHERE u.company_id = ${companyId}
        ORDER BY u.created_at ASC
        LIMIT 1
      `);
      userRows = (fallback as any).rows || fallback || [];
    }

    if (userRows.length === 0) {
      throw new ApiError(404, 'No users found for this company');
    }

    const targetUser = userRows[0] as {
      id: string; email: string; name: string; role: string;
      company_id: string; company_name: string; cuit: string;
    };

    const impersonationToken = jwt.sign(
      {
        id: targetUser.id,
        email: targetUser.email,
        company_id: targetUser.company_id,
        role: targetUser.role,
        impersonating: true,
        readonly: true,
        superadmin_id: superadminUserId,
      },
      env.JWT_SECRET,
      { expiresIn: '1h' } as any
    );

    await db.execute(sql`
      INSERT INTO audit_log (company_id, user_id, action, resource, resource_id)
      VALUES (${companyId}, ${superadminUserId}, 'impersonate', 'company', ${companyId})
    `);

    return {
      token: impersonationToken,
      company: {
        id: targetUser.company_id,
        name: targetUser.company_name,
        cuit: targetUser.cuit,
      },
      user: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        role: targetUser.role,
        company_id: targetUser.company_id,
      },
    };
  }

  /**
   * Get system-wide statistics including SaaS metrics.
   */
  async getSystemStats() {
    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM companies) AS total_companies,
        (SELECT COUNT(*)::int FROM companies WHERE onboarding_completed = true) AS active_companies,
        (SELECT COUNT(*)::int FROM companies WHERE onboarding_completed = false) AS trial_companies,
        (SELECT COUNT(*)::int FROM companies WHERE blocked = true) AS blocked_companies,
        (SELECT COUNT(*)::int FROM users WHERE active = true) AS active_users,
        (SELECT COUNT(*)::int FROM users) AS total_users,
        (SELECT COUNT(*)::int FROM invoices WHERE created_at >= date_trunc('month', NOW())) AS invoices_this_month,
        (SELECT COALESCE(SUM(total_amount), 0)::numeric FROM invoices WHERE status = 'authorized' AND created_at >= date_trunc('month', NOW())) AS revenue_this_month,
        (SELECT COUNT(*)::int FROM companies WHERE created_at >= NOW() - INTERVAL '7 days') AS new_companies_last_week,
        (SELECT COUNT(*)::int FROM companies WHERE created_at >= NOW() - INTERVAL '30 days') AS new_companies_last_month
    `);
    const rows = (result as any).rows || result || [];
    const stats = rows[0] || {};

    // Growth: new companies per week for the last 12 weeks
    const growthResult = await db.execute(sql`
      SELECT
        date_trunc('week', created_at) AS week,
        COUNT(*)::int AS count
      FROM companies
      WHERE created_at >= NOW() - INTERVAL '12 weeks'
      GROUP BY week
      ORDER BY week ASC
    `);
    const growthRows = (growthResult as any).rows || growthResult || [];

    // MRR calculation: count active paid subscriptions and sum plan prices
    const mrrResult = await pool.query(`
      SELECT
        s.plan,
        COUNT(*)::int AS count
      FROM subscriptions s
      WHERE s.status = 'active' AND s.plan != 'trial'
      GROUP BY s.plan
    `);
    let mrr = 0;
    for (const row of mrrResult.rows) {
      const plan = getPlan(row.plan);
      if (plan) {
        mrr += plan.priceArsMonthly * row.count;
      }
    }

    // Churn rate: companies that cancelled this month / total active at start of month
    const churnResult = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'cancelled' AND updated_at >= date_trunc('month', NOW())) AS cancelled_this_month,
        (SELECT COUNT(*)::int FROM subscriptions WHERE status IN ('active', 'cancelled')) AS total_ever_active
    `);
    const churnData = churnResult.rows[0] || { cancelled_this_month: 0, total_ever_active: 0 };
    const churnRate = churnData.total_ever_active > 0
      ? Math.round((churnData.cancelled_this_month / churnData.total_ever_active) * 10000) / 100
      : 0;

    // Trial-to-paid conversion rate
    const conversionResult = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'active' AND plan != 'trial') AS paid_count,
        (SELECT COUNT(*)::int FROM subscriptions) AS total_subscriptions
    `);
    const convData = conversionResult.rows[0] || { paid_count: 0, total_subscriptions: 0 };
    const conversionRate = convData.total_subscriptions > 0
      ? Math.round((convData.paid_count / convData.total_subscriptions) * 10000) / 100
      : 0;

    // Average revenue per company
    const arpcResult = await pool.query(`
      SELECT
        COALESCE(AVG(monthly_rev), 0)::numeric AS avg_revenue
      FROM (
        SELECT
          i.company_id,
          SUM(i.total_amount)::numeric AS monthly_rev
        FROM invoices i
        WHERE i.status = 'authorized' AND i.created_at >= date_trunc('month', NOW())
        GROUP BY i.company_id
      ) sub
    `);
    const avgRevenuePerCompany = parseFloat(arpcResult.rows[0]?.avg_revenue || '0');

    // Plan distribution
    const planDistResult = await pool.query(`
      SELECT
        COALESCE(s.plan, 'trial') AS plan,
        s.status,
        COUNT(*)::int AS count
      FROM subscriptions s
      GROUP BY s.plan, s.status
      ORDER BY s.plan
    `);

    return {
      ...stats,
      growth: growthRows,
      mrr: Math.round(mrr),
      churn_rate: churnRate,
      conversion_rate: conversionRate,
      avg_revenue_per_company: Math.round(avgRevenuePerCompany * 100) / 100,
      plan_distribution: planDistResult.rows,
    };
  }

  /**
   * Get system health metrics.
   */
  async getSystemHealth() {
    const dbSizeResult = await pool.query(`
      SELECT pg_database_size(current_database()) AS db_size_bytes
    `);
    const dbSizeBytes = parseInt(dbSizeResult.rows[0]?.db_size_bytes || '0', 10);

    const poolStats = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };

    const memUsage = process.memoryUsage();
    const uptime = process.uptime();

    const tableCountsResult = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM companies) AS companies,
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM invoices) AS invoices,
        (SELECT COUNT(*)::int FROM orders) AS orders,
        (SELECT COUNT(*)::int FROM products) AS products,
        (SELECT COUNT(*)::int FROM sessions) AS active_sessions
    `);
    const tableCounts = tableCountsResult.rows[0] || {};

    return {
      database: {
        size_bytes: dbSizeBytes,
        size_mb: Math.round(dbSizeBytes / 1024 / 1024 * 100) / 100,
        connection_pool: poolStats,
        table_counts: tableCounts,
      },
      memory: {
        rss_mb: Math.round(memUsage.rss / 1024 / 1024 * 100) / 100,
        heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100,
        heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100,
        external_mb: Math.round(memUsage.external / 1024 / 1024 * 100) / 100,
      },
      uptime_seconds: Math.round(uptime),
      uptime_formatted: formatUptime(uptime),
      node_version: process.version,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a company manually (for enterprise onboarding).
   */
  async createCompanyManual(data: {
    name: string;
    cuit: string;
    adminEmail: string;
    adminName: string;
    plan: string;
    billingPeriod: string;
  }, superadminUserId: string) {
    // Validate required fields
    if (!data.name || !data.cuit || !data.adminEmail || !data.adminName) {
      throw new ApiError(400, 'All fields are required: name, cuit, adminEmail, adminName');
    }

    // Check CUIT uniqueness
    const existingCuit = await pool.query(
      `SELECT id FROM companies WHERE cuit = $1`,
      [data.cuit]
    );
    if (existingCuit.rows.length > 0) {
      throw new ApiError(409, `CUIT ${data.cuit} already registered`);
    }

    // Check email uniqueness
    const existingEmail = await pool.query(
      `SELECT id FROM users WHERE email = $1`,
      [data.adminEmail]
    );
    if (existingEmail.rows.length > 0) {
      throw new ApiError(409, `Email ${data.adminEmail} already registered`);
    }

    // Determine subscription status and trial end
    const isTrial = data.plan === 'trial';
    const trialEndsAt = isTrial ? new Date(Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000) : null;

    // Create company
    const companyResult = await pool.query(
      `INSERT INTO companies (name, cuit, subscription_status, subscription_plan, trial_ends_at, billing_period, onboarding_completed)
       VALUES ($1, $2, $3, $4, $5, $6, false)
       RETURNING *`,
      [
        data.name,
        data.cuit,
        isTrial ? 'trial' : 'active',
        data.plan,
        trialEndsAt?.toISOString() || null,
        data.billingPeriod || 'monthly',
      ]
    );
    const company = companyResult.rows[0];

    // Generate temporary password
    const tempPassword = crypto.randomBytes(8).toString('base64url');
    const hashedPassword = await bcrypt.hash(tempPassword, env.BCRYPT_ROUNDS);

    // Create admin user
    const userResult = await pool.query(
      `INSERT INTO users (company_id, email, password_hash, name, role, active, email_verified)
       VALUES ($1, $2, $3, $4, 'owner', true, true)
       RETURNING id, email, name, role`,
      [company.id, data.adminEmail, hashedPassword, data.adminName]
    );
    const user = userResult.rows[0];

    // Create subscription record
    const now = new Date();
    const periodEnd = new Date(now);
    if (!isTrial) {
      if (data.billingPeriod === 'annual') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }
    }

    await pool.query(
      `INSERT INTO subscriptions (company_id, plan, status, trial_ends_at, current_period_start, current_period_end)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (company_id) DO NOTHING`,
      [
        company.id,
        data.plan,
        isTrial ? 'trial' : 'active',
        trialEndsAt?.toISOString() || null,
        isTrial ? null : now.toISOString(),
        isTrial ? null : periodEnd.toISOString(),
      ]
    );

    // Audit log
    await pool.query(
      `INSERT INTO audit_log (company_id, user_id, action, resource, new_values)
       VALUES ($1, $2, 'company_created_manual', 'company', $3::jsonb)`,
      [company.id, superadminUserId, JSON.stringify({
        name: data.name,
        cuit: data.cuit,
        plan: data.plan,
        billing_period: data.billingPeriod,
      })]
    );

    return {
      success: true,
      company: {
        id: company.id,
        name: company.name,
        cuit: company.cuit,
      },
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      temp_password: tempPassword,
      message: `Company created. Temporary password: ${tempPassword}`,
    };
  }

  /**
   * Update plan/billing for a company.
   */
  async updateCompanyPlan(
    companyId: string,
    data: {
      plan?: string;
      billingPeriod?: string;
      planOverrides?: Record<string, any>;
      trialExtensionDays?: number;
    },
    superadminUserId: string
  ) {
    const check = await pool.query(`SELECT id, name, subscription_plan, billing_period, plan_overrides, trial_ends_at, trial_extended_days FROM companies WHERE id = $1`, [companyId]);
    if (check.rows.length === 0) {
      throw new ApiError(404, 'Company not found');
    }
    const company = check.rows[0];
    const oldValues = {
      plan: company.subscription_plan,
      billing_period: company.billing_period,
      plan_overrides: company.plan_overrides,
      trial_extended_days: company.trial_extended_days,
    };

    const updates: string[] = [];
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (data.plan !== undefined) {
      // Validate plan exists
      const planDef = getPlan(data.plan);
      if (!planDef) {
        throw new ApiError(400, `Invalid plan: ${data.plan}`);
      }
      updates.push(`subscription_plan = $${paramIdx}`);
      params.push(data.plan);
      paramIdx++;

      // Update subscription status
      const isTrial = data.plan === 'trial';
      updates.push(`subscription_status = $${paramIdx}`);
      params.push(isTrial ? 'trial' : 'active');
      paramIdx++;

      // Also update subscriptions table
      const now = new Date();
      const periodEnd = new Date(now);
      if (data.billingPeriod === 'annual') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      await pool.query(
        `UPDATE subscriptions SET
          plan = $2, status = $3,
          current_period_start = $4, current_period_end = $5,
          updated_at = NOW()
         WHERE company_id = $1`,
        [companyId, data.plan, isTrial ? 'trial' : 'active', now.toISOString(), periodEnd.toISOString()]
      );
    }

    if (data.billingPeriod !== undefined) {
      updates.push(`billing_period = $${paramIdx}`);
      params.push(data.billingPeriod);
      paramIdx++;
    }

    if (data.planOverrides !== undefined) {
      updates.push(`plan_overrides = $${paramIdx}::jsonb`);
      params.push(JSON.stringify(data.planOverrides));
      paramIdx++;
    }

    if (data.trialExtensionDays !== undefined && data.trialExtensionDays > 0) {
      const currentExtension = company.trial_extended_days || 0;
      const newTotal = currentExtension + data.trialExtensionDays;
      updates.push(`trial_extended_days = $${paramIdx}`);
      params.push(newTotal);
      paramIdx++;

      // Extend trial_ends_at
      if (company.trial_ends_at) {
        const currentEnd = new Date(company.trial_ends_at);
        currentEnd.setDate(currentEnd.getDate() + data.trialExtensionDays);
        updates.push(`trial_ends_at = $${paramIdx}`);
        params.push(currentEnd.toISOString());
        paramIdx++;

        // Update subscriptions table too
        await pool.query(
          `UPDATE subscriptions SET trial_ends_at = $2, updated_at = NOW() WHERE company_id = $1`,
          [companyId, currentEnd.toISOString()]
        );
      }
    }

    if (updates.length === 0) {
      throw new ApiError(400, 'No updates provided');
    }

    updates.push('updated_at = NOW()');
    await pool.query(
      `UPDATE companies SET ${updates.join(', ')} WHERE id = $1`,
      params
    );

    // Audit log
    await pool.query(
      `INSERT INTO audit_log (company_id, user_id, action, resource, old_values, new_values)
       VALUES ($1, $2, 'plan_updated', 'company', $3::jsonb, $4::jsonb)`,
      [companyId, superadminUserId, JSON.stringify(oldValues), JSON.stringify(data)]
    );

    return { success: true, message: `Plan updated for company ${company.name}` };
  }

  /**
   * List available backups for a company (simulated from filesystem).
   * In production this would query a backup registry/S3.
   */
  async listBackups(companyId: string) {
    // Verify company exists
    const check = await pool.query(`SELECT id, name FROM companies WHERE id = $1`, [companyId]);
    if (check.rows.length === 0) {
      throw new ApiError(404, 'Company not found');
    }

    // In a real implementation, this would list from S3 or a backup registry table.
    // For now, return the last 7 days of potential backup slots.
    const backups = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      backups.push({
        id: `backup_${companyId}_${dateStr}`,
        date: dateStr,
        timestamp: date.toISOString(),
        company_id: companyId,
        company_name: check.rows[0].name,
        size_mb: Math.round(Math.random() * 50 + 10), // placeholder
        status: i === 0 ? 'latest' : 'available',
      });
    }

    return backups;
  }

  /**
   * Restore a backup for a company (placeholder - calls restore script).
   */
  async restoreBackup(companyId: string, backupId: string, superadminUserId: string) {
    const check = await pool.query(`SELECT id, name FROM companies WHERE id = $1`, [companyId]);
    if (check.rows.length === 0) {
      throw new ApiError(404, 'Company not found');
    }

    // Audit log BEFORE restore
    await pool.query(
      `INSERT INTO audit_log (company_id, user_id, action, resource, new_values)
       VALUES ($1, $2, 'backup_restore_initiated', 'company', $3::jsonb)`,
      [companyId, superadminUserId, JSON.stringify({ backup_id: backupId })]
    );

    // In production, this would trigger the actual restore process.
    // For now, return a status indicating the restore was queued.
    return {
      success: true,
      message: `Backup restore initiated for company ${check.rows[0].name}. Backup: ${backupId}`,
      status: 'queued',
    };
  }

  /**
   * Get audit trail for a company.
   */
  async getAuditTrail(companyId: string, limit: number = 50) {
    const result = await pool.query(
      `SELECT al.*, u.email as user_email, u.name as user_name
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE al.company_id = $1
       ORDER BY al.created_at DESC
       LIMIT $2`,
      [companyId, limit]
    );
    return result.rows;
  }

  /**
   * Export all data for a company as JSON backup.
   * Verifies row counts after export and stores metadata.
   */
  async backupCompany(companyId: string): Promise<{
    metadata: { company_id: string; exported_at: string; row_counts: Record<string, number> };
    data: Record<string, any[]>;
  }> {
    // Verify company exists
    const check = await pool.query('SELECT id, name FROM companies WHERE id = $1', [companyId]);
    if (check.rows.length === 0) {
      throw new ApiError(404, 'Company not found');
    }

    const backup = await exportCompanyData(companyId);

    // Verify row counts against actual DB counts for critical tables
    const verifyTables = ['orders', 'invoices', 'products', 'customers'];
    for (const table of verifyTables) {
      try {
        const countResult = await pool.query(
          `SELECT COUNT(*)::int as cnt FROM ${table} WHERE company_id = $1`,
          [companyId]
        );
        const dbCount = countResult.rows[0]?.cnt || 0;
        const backupCount = backup.metadata.row_counts[table] || 0;
        if (dbCount !== backupCount) {
          console.warn(`Backup verification warning: ${table} has ${dbCount} rows in DB but ${backupCount} in backup`);
        }
      } catch {
        // Table may not exist
      }
    }

    // Log backup in audit
    await pool.query(
      `INSERT INTO audit_log (company_id, action, resource, new_values)
       VALUES ($1, 'company_backup', 'company', $2::jsonb)`,
      [companyId, JSON.stringify({
        row_counts: backup.metadata.row_counts,
        exported_at: backup.metadata.exported_at,
      })]
    );

    return backup;
  }

  /**
   * Restore company data from a JSON backup.
   * WARNING: Destructive operation -- replaces all company data.
   */
  async restoreCompany(companyId: string, backupData: {
    metadata: { company_id: string; exported_at: string; row_counts: Record<string, number> };
    data: Record<string, any[]>;
  }): Promise<{ success: boolean; message: string }> {
    // Verify company exists
    const check = await pool.query('SELECT id FROM companies WHERE id = $1', [companyId]);
    if (check.rows.length === 0) {
      throw new ApiError(404, 'Company not found');
    }

    // Verify backup belongs to same company
    if (backupData.metadata.company_id !== companyId) {
      throw new ApiError(400, `Backup is for company ${backupData.metadata.company_id}, not ${companyId}`);
    }

    // Log restore start in audit
    await pool.query(
      `INSERT INTO audit_log (company_id, action, resource, new_values)
       VALUES ($1, 'company_restore_started', 'company', $2::jsonb)`,
      [companyId, JSON.stringify({
        backup_date: backupData.metadata.exported_at,
        row_counts: backupData.metadata.row_counts,
      })]
    );

    // NOTE: Full restore requires careful FK ordering.
    // For MVP, we return the backup data and let the restore script handle it.
    // A full programmatic restore would be complex and error-prone here.
    return {
      success: true,
      message: `Restore data received for company ${companyId}. Use scripts/restore-company.sh for full restore.`,
    };
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

export const adminService = new AdminService();
