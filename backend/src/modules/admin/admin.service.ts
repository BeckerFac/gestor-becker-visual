import { db, pool } from '../../config/db';
import { sql } from 'drizzle-orm';
import { env } from '../../config/env';
import { ApiError } from '../../middlewares/errorHandler';
import jwt from 'jsonwebtoken';

export class AdminService {
  /**
   * List all companies with aggregated stats.
   */
  async getAllCompanies() {
    const result = await db.execute(sql`
      SELECT
        c.id,
        c.name,
        c.cuit,
        c.onboarding_completed,
        c.created_at,
        c.updated_at,
        c.enabled_modules,
        COALESCE(u_count.cnt, 0) AS users_count,
        u_count.last_activity,
        COALESCE(inv_count.cnt, 0) AS invoices_count_this_month
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
      ORDER BY c.created_at DESC
    `);
    const rows = (result as any).rows || result || [];
    return rows;
  }

  /**
   * Get full detail for a single company including its users and usage stats.
   */
  async getCompanyDetail(companyId: string) {
    // Company info
    const companyResult = await db.execute(sql`
      SELECT * FROM companies WHERE id = ${companyId}
    `);
    const companyRows = (companyResult as any).rows || companyResult || [];
    if (companyRows.length === 0) {
      throw new ApiError(404, 'Company not found');
    }
    const company = companyRows[0];

    // Users
    const usersResult = await db.execute(sql`
      SELECT id, email, name, role, active, last_login, created_at
      FROM users
      WHERE company_id = ${companyId}
      ORDER BY created_at ASC
    `);
    const usersRows = (usersResult as any).rows || usersResult || [];

    // Usage stats
    const statsResult = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM products WHERE company_id = ${companyId}) AS products_count,
        (SELECT COUNT(*)::int FROM customers WHERE company_id = ${companyId}) AS customers_count,
        (SELECT COUNT(*)::int FROM invoices WHERE company_id = ${companyId}) AS total_invoices,
        (SELECT COUNT(*)::int FROM invoices WHERE company_id = ${companyId} AND created_at >= date_trunc('month', NOW())) AS invoices_this_month,
        (SELECT COUNT(*)::int FROM orders WHERE company_id = ${companyId}) AS total_orders,
        (SELECT COALESCE(SUM(total_amount), 0)::numeric FROM invoices WHERE company_id = ${companyId} AND status = 'authorized') AS total_revenue
    `);
    const statsRows = (statsResult as any).rows || statsResult || [];
    const stats = statsRows[0] || {};

    return {
      company,
      users: usersRows,
      stats,
    };
  }

  /**
   * Disable a company (set all users to inactive + log reason).
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
   * Re-enable a company (reactivate all users).
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
   * The token includes a special flag `impersonating: true` and `readonly: true`.
   */
  async impersonateCompany(companyId: string, superadminUserId: string) {
    // Get a user from the company (prefer admin)
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
      // Fallback: any user
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

    // Generate a short-lived token (1 hour) with impersonation markers
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

    // Log impersonation
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
   * Get system-wide statistics.
   */
  async getSystemStats() {
    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM companies) AS total_companies,
        (SELECT COUNT(*)::int FROM companies WHERE onboarding_completed = true) AS active_companies,
        (SELECT COUNT(*)::int FROM companies WHERE onboarding_completed = false) AS trial_companies,
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

    return {
      ...stats,
      growth: growthRows,
    };
  }

  /**
   * Get system health metrics.
   */
  async getSystemHealth() {
    // DB size
    const dbSizeResult = await pool.query(`
      SELECT pg_database_size(current_database()) AS db_size_bytes
    `);
    const dbSizeBytes = parseInt(dbSizeResult.rows[0]?.db_size_bytes || '0', 10);

    // Connection pool stats
    const poolStats = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };

    // Memory usage
    const memUsage = process.memoryUsage();

    // Uptime
    const uptime = process.uptime();

    // Table row counts
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
