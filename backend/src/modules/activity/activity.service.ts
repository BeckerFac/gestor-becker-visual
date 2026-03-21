import { pool } from '../../config/db';
import logger from '../../config/logger';
import { createHash } from 'crypto';

interface LogParams {
  companyId: string;
  userId: string;
  action: string;
  module: string;
  entityType: string;
  entityId?: string;
  description: string;
  changes?: Record<string, { old: any; new: any }>;
  ipAddress?: string;
  metadata?: Record<string, any>;
}

interface LogFilters {
  userId?: string;
  module?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  limit?: number;
}

class ActivityService {
  async log(params: LogParams): Promise<void> {
    try {
      const now = new Date();
      const checksumData = `${params.action}|${params.entityType}|${params.entityId || ''}|${now.toISOString()}|${params.userId}`;
      const checksum = createHash('sha256').update(checksumData).digest('hex');

      await pool.query(
        `INSERT INTO audit_log (company_id, user_id, action, entity_type, entity_id, details, ip_address, module, changes, metadata, checksum, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          params.companyId,
          params.userId || null,
          params.action,
          params.entityType,
          params.entityId || null,
          JSON.stringify({
            description: params.description,
            ...(params.metadata?.description_rich ? { description_rich: params.metadata.description_rich } : {}),
          }),
          params.ipAddress || null,
          params.module || null,
          params.changes ? JSON.stringify(params.changes) : null,
          params.metadata ? JSON.stringify(params.metadata) : null,
          checksum,
          now,
        ]
      );
    } catch (err) {
      // Fire-and-forget: never block the main operation
      logger.error({ err }, 'Activity log write failed');
    }
  }

  async getLogs(companyId: string, filters: LogFilters) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE a.company_id = $1';
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (filters.userId) {
      whereClause += ` AND a.user_id = $${paramIdx++}`;
      params.push(filters.userId);
    }
    if (filters.module) {
      whereClause += ` AND a.module = $${paramIdx++}`;
      params.push(filters.module);
    }
    if (filters.action) {
      whereClause += ` AND a.action = $${paramIdx++}`;
      params.push(filters.action);
    }
    if (filters.dateFrom) {
      whereClause += ` AND a.created_at >= $${paramIdx++}::timestamp`;
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      whereClause += ` AND a.created_at <= ($${paramIdx++}::timestamp + interval '1 day')`;
      params.push(filters.dateTo);
    }
    if (filters.search) {
      whereClause += ` AND (a.details::text ILIKE $${paramIdx} OR a.entity_type ILIKE $${paramIdx} OR a.action ILIKE $${paramIdx} OR u.name ILIKE $${paramIdx})`;
      params.push(`%${filters.search}%`);
      paramIdx++;
    }

    try {
      const countResult = await pool.query(
        `SELECT COUNT(*)::int as total FROM audit_log a LEFT JOIN users u ON a.user_id::uuid = u.id ${whereClause}`,
        params
      );
      const total = countResult.rows[0]?.total || 0;

      const dataResult = await pool.query(
        `SELECT a.*, u.name as user_name, u.email as user_email, u.role as user_role
         FROM audit_log a
         LEFT JOIN users u ON a.user_id::uuid = u.id
         ${whereClause}
         ORDER BY a.created_at DESC
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...params, limit, offset]
      );

      return {
        items: (dataResult.rows || []).map((row: any) => ({
          id: row.id,
          action: row.action,
          module: row.module || row.entity_type || '-',
          entityType: row.entity_type,
          entityId: row.entity_id,
          description: row.details?.description_rich || row.details?.description || row.details || '-',
          descriptionSimple: row.details?.description || '-',
          changes: row.changes,
          metadata: row.metadata,
          ipAddress: row.ip_address,
          checksum: row.checksum,
          userName: row.user_name || row.user_email || 'Sistema',
          userRole: row.user_role || '-',
          userId: row.user_id,
          createdAt: row.created_at,
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (err) {
      logger.error({ err }, 'Activity getLogs failed');
      return { items: [], total: 0, page, limit, totalPages: 0 };
    }
  }

  async getAllLogs(filters: LogFilters & { companyId?: string }) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (filters.companyId) {
      whereClause += ` AND a.company_id = $${paramIdx++}`;
      params.push(filters.companyId);
    }
    if (filters.userId) {
      whereClause += ` AND a.user_id = $${paramIdx++}`;
      params.push(filters.userId);
    }
    if (filters.module) {
      whereClause += ` AND a.module = $${paramIdx++}`;
      params.push(filters.module);
    }
    if (filters.action) {
      whereClause += ` AND a.action = $${paramIdx++}`;
      params.push(filters.action);
    }
    if (filters.dateFrom) {
      whereClause += ` AND a.created_at >= $${paramIdx++}::timestamp`;
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      whereClause += ` AND a.created_at <= ($${paramIdx++}::timestamp + interval '1 day')`;
      params.push(filters.dateTo);
    }
    if (filters.search) {
      whereClause += ` AND (a.details::text ILIKE $${paramIdx} OR a.entity_type ILIKE $${paramIdx} OR a.action ILIKE $${paramIdx} OR u.name ILIKE $${paramIdx})`;
      params.push(`%${filters.search}%`);
      paramIdx++;
    }

    try {
      const countResult = await pool.query(
        `SELECT COUNT(*)::int as total FROM audit_log a LEFT JOIN users u ON a.user_id::uuid = u.id ${whereClause}`,
        params
      );
      const total = countResult.rows[0]?.total || 0;

      const dataResult = await pool.query(
        `SELECT a.*, u.name as user_name, u.email as user_email, u.role as user_role,
                c.name as company_name
         FROM audit_log a
         LEFT JOIN users u ON a.user_id::uuid = u.id
         LEFT JOIN companies c ON a.company_id = c.id
         ${whereClause}
         ORDER BY a.created_at DESC
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...params, limit, offset]
      );

      return {
        items: (dataResult.rows || []).map((row: any) => ({
          id: row.id,
          action: row.action,
          module: row.module || row.entity_type || '-',
          entityType: row.entity_type,
          entityId: row.entity_id,
          description: row.details?.description_rich || row.details?.description || row.details || '-',
          descriptionSimple: row.details?.description || '-',
          changes: row.changes,
          metadata: row.metadata,
          ipAddress: row.ip_address,
          checksum: row.checksum,
          userName: row.user_name || row.user_email || 'Sistema',
          userRole: row.user_role || '-',
          userId: row.user_id,
          companyId: row.company_id,
          companyName: row.company_name || '-',
          createdAt: row.created_at,
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (err) {
      logger.error({ err }, 'Activity getAllLogs failed');
      return { items: [], total: 0, page, limit, totalPages: 0 };
    }
  }

  async getLogStats() {
    try {
      const [
        logsPerCompany,
        logsCounts,
        activeUsers,
        topModules,
        actionsBreakdown,
      ] = await Promise.all([
        pool.query(
          `SELECT c.name as company_name, c.id as company_id, COUNT(*)::int as total
           FROM audit_log a
           JOIN companies c ON a.company_id = c.id
           GROUP BY c.id, c.name
           ORDER BY total DESC
           LIMIT 10`
        ),
        pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE a.created_at >= CURRENT_DATE)::int as today,
             COUNT(*) FILTER (WHERE a.created_at >= DATE_TRUNC('week', CURRENT_DATE))::int as this_week,
             COUNT(*) FILTER (WHERE a.created_at >= DATE_TRUNC('month', CURRENT_DATE))::int as this_month
           FROM audit_log a`
        ),
        pool.query(
          `SELECT COALESCE(u.name, u.email, a.user_id) as user_name, COUNT(*)::int as total
           FROM audit_log a
           LEFT JOIN users u ON a.user_id::uuid = u.id
           WHERE a.created_at >= CURRENT_DATE - interval '7 days'
           GROUP BY COALESCE(u.name, u.email, a.user_id)
           ORDER BY total DESC
           LIMIT 5`
        ),
        pool.query(
          `SELECT COALESCE(a.module, a.entity_type) as module, COUNT(*)::int as total
           FROM audit_log a
           WHERE a.created_at >= CURRENT_DATE - interval '30 days'
           GROUP BY COALESCE(a.module, a.entity_type)
           ORDER BY total DESC
           LIMIT 10`
        ),
        pool.query(
          `SELECT a.action, COUNT(*)::int as total
           FROM audit_log a
           WHERE a.created_at >= CURRENT_DATE - interval '30 days'
           GROUP BY a.action
           ORDER BY total DESC`
        ),
      ]);

      const counts = logsCounts.rows[0] || { today: 0, this_week: 0, this_month: 0 };

      return {
        logsPerCompany: logsPerCompany.rows,
        today: counts.today,
        thisWeek: counts.this_week,
        thisMonth: counts.this_month,
        activeUsers: activeUsers.rows,
        topModules: topModules.rows,
        actionsBreakdown: actionsBreakdown.rows,
      };
    } catch (err) {
      logger.error({ err }, 'Activity getLogStats failed');
      return {
        logsPerCompany: [],
        today: 0,
        thisWeek: 0,
        thisMonth: 0,
        activeUsers: [],
        topModules: [],
        actionsBreakdown: [],
      };
    }
  }

  async purgeOldLogs(retentionDays: number): Promise<number> {
    try {
      const result = await pool.query(
        `DELETE FROM audit_log WHERE created_at < NOW() - ($1 || ' days')::interval RETURNING id`,
        [retentionDays.toString()]
      );
      return result.rowCount || 0;
    } catch (err) {
      logger.error({ err }, 'Activity purge failed');
      return 0;
    }
  }
}

export const activityService = new ActivityService();
