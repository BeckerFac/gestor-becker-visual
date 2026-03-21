import { pool } from '../../config/db';
import logger from '../../config/logger';

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
      await pool.query(
        `INSERT INTO audit_log (company_id, user_id, action, entity_type, entity_id, details, ip_address, module, changes, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          params.companyId,
          params.userId || null,
          params.action,
          params.entityType,
          params.entityId || null,
          JSON.stringify({ description: params.description }),
          params.ipAddress || null,
          params.module || null,
          params.changes ? JSON.stringify(params.changes) : null,
          params.metadata ? JSON.stringify(params.metadata) : null,
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
          description: row.details?.description || row.details || '-',
          changes: row.changes,
          metadata: row.metadata,
          ipAddress: row.ip_address,
          userName: row.user_name || row.user_email || 'Sistema',
          userRole: row.user_role || '-',
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
